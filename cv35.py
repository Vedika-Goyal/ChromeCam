#filter color with opencv
import cv2
import numpy as np
cap=cv2.VideoCapture(0)
def wscube(x):
   pass
cv2.namedWindow("demo")
cv2.createTrackbar("lb","demo",0,255,wscube)
cv2.createTrackbar("lg","demo",0,255,wscube)
cv2.createTrackbar("lr","demo",0,255,wscube)
cv2.createTrackbar("ub","demo",255,255,wscube)
cv2.createTrackbar("ug","demo",255,255,wscube)
cv2.createTrackbar("ur","demo",255,255,wscube)
while cap.isOpened():
    r,frame=cap.read()
    if r==True:
       frame=cv2.resize(frame,(500,500))
       hsv_img=cv2.cvtColor(frame,cv2.COLOR_BGR2HSV)
       lb=cv2.getTrackbarPos("lb","demo")
       lg=cv2.getTrackbarPos("lg","demo")
       lr=cv2.getTrackbarPos("lr","demo")
       ub=cv2.getTrackbarPos("ub","demo")
       ug=cv2.getTrackbarPos("ug","demo")
       ur=cv2.getTrackbarPos("ur","demo")
       lo=np.array([lb,lg,lr])
       up=np.array([ub,ug,ur])
       masks=cv2.inRange(hsv_img,lo,up)
       res=cv2.bitwise_and(frame,frame,mask=masks)
       cv2.imshow("W1",res)
       cv2.imshow("W2",masks)
       cv2.imshow("W3",hsv_img)
       cv2.imshow("W4",frame)
       if cv2.waitKey(25)&0xff==ord("p"):
         break 
    else:
       break
cap.release()
cv2.destroyAllWindows()    