import os
import uuid
import cv2
import numpy as np
import mediapipe as mp
import subprocess
from fastapi import FastAPI, File, UploadFile, Query, HTTPException
from fastapi.responses import FileResponse, Response
from typing import Dict

app = FastAPI(title="ChromaCam Virtual Studio", version="1.2.0")

RECORDINGS_DIR = "recordings"
UPLOADS_DIR = "uploads"
os.makedirs(RECORDINGS_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)

selfie_segmentation = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=1)

background_images_cache: Dict[str, np.ndarray] = {}
recording_sessions: Dict[str, 'RecordingSession'] = {}

class RecordingSession:
    def __init__(self, video_id: str, width: int, height: int, fps: float):
        self.video_id = video_id
        self.filename = os.path.join(RECORDINGS_DIR, f"{video_id}.mp4")
        self.width = width
        self.height = height
        self.fps = fps
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        self.writer = cv2.VideoWriter(self.filename, fourcc, fps, (width, height))
        self.active = True
        
        # Real-time synchronization parameters
        import time
        self.start_time = None
        self.frames_written = 0

    def write_frame(self, frame: np.ndarray):
        if not self.active or self.writer is None:
            return
            
        import time
        current_time = time.time()
        if self.start_time is None:
            self.start_time = current_time
            
        frame_resized = cv2.resize(frame, (self.width, self.height))
        
        # Calculate how many frames should have been written based on elapsed time
        elapsed_time = current_time - self.start_time
        expected_frames = int(elapsed_time * self.fps)
        
        # Interpolate duplicate frames to fill the time gap if lag occurred
        frames_to_write = max(1, expected_frames - self.frames_written)
        
        for _ in range(frames_to_write):
            self.writer.write(frame_resized)
            
        self.frames_written += frames_to_write

    def close(self):
        if self.writer is not None:
            self.writer.release()
            self.writer = None
        self.active = False

def hex_to_bgr(hex_str: str) -> np.ndarray:
    hex_str = hex_str.lstrip("#")
    if len(hex_str) != 6:
        return np.array([30, 41, 59], dtype=np.uint8)
    r = int(hex_str[0:2], 16)
    g = int(hex_str[2:4], 16)
    b = int(hex_str[4:6], 16)
    return np.array([b, g, r], dtype=np.uint8)

@app.post("/upload_background")
async def upload_background(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        bg_img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if bg_img is None:
            raise HTTPException(status_code=400, detail="Invalid background image")

        bg_id = str(uuid.uuid4())
        file_path = os.path.join(UPLOADS_DIR, f"{bg_id}.jpg")
        cv2.imwrite(file_path, bg_img)
        
        background_images_cache[bg_id] = bg_img
        
        return {"status": "success", "background_id": bg_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@app.post("/start_recording")
async def start_recording(width: int = Query(640), height: int = Query(480), fps: float = Query(20.0)):
    video_id = str(uuid.uuid4())
    try:
        session = RecordingSession(video_id, width, height, fps)
        recording_sessions[video_id] = session
        return {"status": "success", "video_id": video_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Recording start failed: {str(e)}")

@app.post("/stop_recording")
async def stop_recording(video_id: str = Query(...)):
    if video_id not in recording_sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session = recording_sessions[video_id]
    session.close()
    return {"status": "success", "video_id": video_id}

@app.post("/upload_audio")
async def upload_audio(file: UploadFile = File(...), video_id: str = Query(...)):
    if video_id not in recording_sessions:
        raise HTTPException(status_code=404, detail="Recording session not found")
    
    try:
        audio_path = os.path.join(RECORDINGS_DIR, f"{video_id}_audio.webm")
        contents = await file.read()
        with open(audio_path, "wb") as f:
            f.write(contents)
            
        video_path = os.path.join(RECORDINGS_DIR, f"{video_id}.mp4")
        merged_path = os.path.join(RECORDINGS_DIR, f"{video_id}_merged.mp4")
        
        if not os.path.exists(video_path):
            raise HTTPException(status_code=404, detail="Video file not found")
            
        # FFmpeg command to multiplex video and audio
        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-i", audio_path,
            "-c:v", "copy",
            "-c:a", "aac",
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-shortest",
            merged_path
        ]
        
        try:
            result = subprocess.run(ffmpeg_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if result.returncode == 0 and os.path.exists(merged_path):
                os.replace(merged_path, video_path)
                if os.path.exists(audio_path):
                    os.remove(audio_path)
                return {"status": "success", "detail": "Audio merged successfully"}
            else:
                print(f"FFmpeg multiplexing failed: {result.stderr}")
        except FileNotFoundError:
            print("FFmpeg not found in path. Serving video file without audio.")
            
        # Fallback cleanup
        if os.path.exists(audio_path):
            os.remove(audio_path)
        return {"status": "success", "detail": "FFmpeg not available; serving silent video instead"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Audio processing error: {str(e)}")

@app.post("/process_frame")
async def process_frame(
    file: UploadFile = File(...),
    color: str = Query("#00ff00"),
    bg_type: str = Query("color"),
    bg_image_id: str = Query(None),
    video_id: str = Query(None)
):
    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if frame is None:
            raise HTTPException(status_code=400, detail="Corrupted frame data")

        # Mirror the frame horizontally for natural user feedback
        frame = cv2.flip(frame, 1)

        # Select background canvas
        if bg_type == "image" and bg_image_id:
            if bg_image_id in background_images_cache:
                bg_image = background_images_cache[bg_image_id]
            else:
                file_path = os.path.join(UPLOADS_DIR, f"{bg_image_id}.jpg")
                if os.path.exists(file_path):
                    bg_image = cv2.imread(file_path)
                    background_images_cache[bg_image_id] = bg_image
                else:
                    bg_image = np.zeros(frame.shape, dtype=np.uint8)
                    bg_image[:] = hex_to_bgr(color)
        else:
            bg_image = np.zeros(frame.shape, dtype=np.uint8)
            bg_image[:] = hex_to_bgr(color)

        # Enforce dimension parity
        if bg_image.shape[0] != frame.shape[0] or bg_image.shape[1] != frame.shape[1]:
            bg_image = cv2.resize(bg_image, (frame.shape[1], frame.shape[0]))

        # Segment human subject
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = selfie_segmentation.process(rgb_frame)
        
        if results.segmentation_mask is not None:
            mask = cv2.GaussianBlur(results.segmentation_mask, (5, 5), 0)
            mask_3d = np.stack((mask,) * 3, axis=-1)
            output_frame = (frame * mask_3d + bg_image * (1.0 - mask_3d)).astype(np.uint8)
        else:
            output_frame = frame

        # Append to recording if session active
        if video_id and video_id in recording_sessions:
            session = recording_sessions[video_id]
            if session.active:
                session.write_frame(output_frame)

        _, encoded_img = cv2.imencode(".jpg", output_frame)
        return Response(content=encoded_img.tobytes(), media_type="image/jpeg")

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Frame error: {str(e)}")

@app.get("/download/{video_id}")
async def download_video(video_id: str):
    video_path = os.path.join(RECORDINGS_DIR, f"{video_id}.mp4")
    if not os.path.exists(video_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(
        path=video_path,
        media_type="video/mp4",
        filename="chromacam_recording.mp4"
    )

@app.get("/")
async def get_index():
    return FileResponse("index.html")

@app.get("/style.css")
async def get_style():
    return FileResponse("style.css")

@app.get("/app.js")
async def get_js():
    return FileResponse("app.js")
