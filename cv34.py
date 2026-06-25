#saving a video in open cv
import cv2
v=cv2.VideoCapture(0)
f=cv2.VideoWriter_fourcc(*"mp4v")
out=cv2.VideoWriter("Demo1.mp4",f,40.0,(700,500))
while v.isOpened():
    r,frame=v.read()
    
    if r==True:
       frame=cv2.resize(frame,(700,500))
       frame=cv2.flip(frame,1)
       out.write(frame)
       cv2.imshow("W",frame)
       if cv2.waitKey(25)&0xff==ord("p"):
          break

    else:
      break 
out.release()       
v.release()
cv2.destroyAllWindows()    