// macOS offscreen GPU regression: compiles the actual fragment shader.
#include <OpenGL/OpenGL.h>
#include <OpenGL/gl3.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static GLuint compile(GLenum type, const char *source) {
  GLuint shader=glCreateShader(type); glShaderSource(shader,1,&source,NULL); glCompileShader(shader);
  GLint ok; glGetShaderiv(shader,GL_COMPILE_STATUS,&ok);
  if(!ok) { char log[16000]; glGetShaderInfoLog(shader,sizeof(log),NULL,log); puts(log); exit(1); }
  return shader;
}
static char *readSource(const char *path) {
  FILE *f=fopen(path,"rb"); if(!f) exit(2); fseek(f,0,SEEK_END); long n=ftell(f); rewind(f);
  char *s=calloc(n+1,1); fread(s,1,n,f); fclose(f); return s;
}
static void uniform(GLuint p,const char *name,float a,float b,float c,float d) {
  glUniform4f(glGetUniformLocation(p,name),a,b,c,d);
}
static float cubic(float t,float a,float b) {return 3*(1-t)*(1-t)*t*a+3*(1-t)*t*t*b+t*t*t;}
int main(int argc,char **argv) {
  if(argc<3) return 2;
  int strip=!strcmp(argv[2],"test"), width=strip?512:1280, height=strip?257:900;
  CGLPixelFormatAttribute attrs[]={kCGLPFAOpenGLProfile,(CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,kCGLPFAAccelerated,0};
  CGLPixelFormatObj pf; GLint count; CGLContextObj ctx;
  if(CGLChoosePixelFormat(attrs,&pf,&count)||CGLCreateContext(pf,0,&ctx)) return 2;
  CGLSetCurrentContext(ctx); CGLDestroyPixelFormat(pf);
  const char *vs="#version 330 core\nout vec2 vUV; void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*vec2(2,-2)+vec2(-1,1),0,1);vUV=p;}";
  char *fs=readSource(argv[1]); GLuint program=glCreateProgram();
  glAttachShader(program,compile(GL_VERTEX_SHADER,vs)); glAttachShader(program,compile(GL_FRAGMENT_SHADER,fs)); glLinkProgram(program);
  GLint linked; glGetProgramiv(program,GL_LINK_STATUS,&linked); if(!linked) return 3; glUseProgram(program);
  GLuint vao,fbo,target,photo,profile; glGenVertexArrays(1,&vao); glBindVertexArray(vao);
  glGenFramebuffers(1,&fbo); glBindFramebuffer(GL_FRAMEBUFFER,fbo);
  glGenTextures(1,&target); glBindTexture(GL_TEXTURE_2D,target);
  glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,width,height,0,GL_RGBA,GL_UNSIGNED_BYTE,NULL);
  glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,target,0);
  if(glCheckFramebufferStatus(GL_FRAMEBUFFER)!=GL_FRAMEBUFFER_COMPLETE) return 4;
  int iw=1024,ih=683; unsigned char *pixels=malloc(iw*ih*4); memset(pixels,255,iw*ih*4);
  if(!strip && argc>4) { FILE *f=fopen(argv[4],"rb"); if(!f) return 5; fread(pixels,4,iw*ih,f); fclose(f); }
  glGenTextures(1,&photo); glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D,photo);
  glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,iw,ih,0,GL_RGBA,GL_UNSIGNED_BYTE,pixels);
  glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_LINEAR_MIPMAP_LINEAR); glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE); glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE); glGenerateMipmap(GL_TEXTURE_2D);
  glUniform1i(glGetUniformLocation(program,"photo"),0);
  glGenTextures(1,&profile); glActiveTexture(GL_TEXTURE1); glBindTexture(GL_TEXTURE_2D,profile);
  glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST); glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
  glUniform1i(glGetUniformLocation(program,"blurProfile"),1);
  uniform(program,"u.media",iw,ih,0,0); uniform(program,"u.raster",width,height,0,0);
  uniform(program,"u.uvX",1,0,0,0); uniform(program,"u.uvY",0,1,0,0);
  uniform(program,"u.frontProjection",1,1,75,.12); uniform(program,"u.frontEdge",1.6,strip?0:.98,.18,1.5);
  uniform(program,"u.frontCorner",.97,1,.006,0); uniform(program,"u.frontBlur",65,1,.24,.44);
  uniform(program,"u.creaseBlur",0,3.1,0,.48690378);
  glViewport(0,0,width,height); unsigned char *out=malloc(width*height*4);
  float curves[4][4]={{1,0,1,.48690378},{0,1,0,1},{1,0,1,0},{1,0,0,1}};
  float poses[]={5,30,60,85,95,120,145,175}; int failures=0;
  for(int ci=0;ci<(strip?4:1);ci++) {
    float table[1025]; for(int i=0;i<=1024;i++) {float x=(float)i/1024,lo=0,hi=1; for(int k=0;k<24;k++){float t=(lo+hi)/2;if(cubic(t,curves[ci][0],curves[ci][2])<x)lo=t;else hi=t;} table[i]=cubic((lo+hi)/2,curves[ci][1],curves[ci][3]);} table[0]=0;table[1024]=1;
    glTexImage2D(GL_TEXTURE_2D,0,GL_R32F,1025,1,0,GL_RED,GL_FLOAT,table);
    for(int strength=0;strength<(strip?2:1);strength++) {
    uniform(program,"u.frontProjection",1,1,strength?160:75,.12);
    uniform(program,"u.frontBlur",strength?120:65,1,.24,.44);
    for(int ai=0;ai<(strip?8:1);ai++) for(int bottom=0;bottom<(strip?2:1);bottom++) {
      float angle=strip?poses[ai]:atof(argv[3]);
      uniform(program,"u.geometry",width,height,strip?500:640,angle/180);
      uniform(program,"testPose",angle>90,angle*.0174532925199433,bottom,0);
      glDrawArrays(GL_TRIANGLES,0,3); glReadPixels(0,0,width,height,GL_RGBA,GL_UNSIGNED_BYTE,out);
      if(glGetError()!=GL_NO_ERROR) return 6;
      if(strip) {
        int minimum=255,maximum=0;
        for(int x=0;x<width;x++){int value=out[(128*width+x)*4];if(value<minimum)minimum=value;if(value>maximum)maximum=value;}
        // White picture + 0.012 black surround gives 0.506 (129/255) at the boundary.
        if(minimum<127||maximum>131) {printf("FAIL curve %d angle %.0f bottom %d: boundary %d..%d\n",ci,angle,bottom,minimum,maximum);failures++;}
      } else {
        FILE *f=fopen(argv[2],"wb");fprintf(f,"P6\n%d %d\n255\n",width,height);
        for(int y=height-1;y>=0;y--)for(int x=0;x<width;x++)fwrite(out+(y*width+x)*4,1,3,f);fclose(f);
      }
    }
  }
  }
  if(strip) printf("GPU straight-boundary regression: %s (128 face/angle/edge/curve/strength cases)\n",failures?"FAIL":"PASS");
  return failures?1:0;
}
