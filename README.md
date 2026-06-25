# ChromaCam - Virtual Background Studio & Video Recorder

ChromaCam is a modern, real-time web application that allows users to replace their webcam background with solid colors or custom images, and record the processed video along with synchronized microphone audio directly from a browser-based dashboard. 

The project is built on top of **FastAPI**, **OpenCV**, and **MediaPipe**, showcasing clean front-end interaction paired with high-performance computer vision pipelines on the backend.

---

## 🌟 Key Features

* **Real-Time Person Segmentation**: Leverages MediaPipe's Selfie Segmentation model (running at ~20 FPS on CPU) with smooth Gaussian edge-blending to separate the foreground subject from their background.
* **Dual Background Modes**:
  * **Solid Color**: Interactive HTML5 color picker + a grid of quick-selection color presets (including Chroma key Green).
  * **Custom Environment**: Drag-and-drop or click to upload any custom image (JPG/PNG). Uploaded images are cached in-memory on the backend for optimal rendering latency.
* **Mirrored Video Stream**: Horizontally flips the camera stream to provide a natural, mirror-like preview workspace while preserving background text orientation.
* **Smooth CFR Recording**: Adapts variable framerate (VFR) HTTP post streams into a solid 20 FPS Constant Framerate (CFR) video file via real-time frame interpolation, preventing fast-forward lag or stutter.
* **Microphone Synchronization**: Automatically captures microphone input natively in the browser and multiplexes it with the processed OpenCV video output using `FFmpeg` on the backend.
* **Clean SaaS UI/UX**: Styled with a dark slate layout (similar to Zoom or Figma), featuring a drag-and-drop upload zone, active stream monitors (resolution, FPS, status), and automated download prompts.
* **Zero-Crash Fallback**: Automatically serves the silent video file if the host machine does not have `ffmpeg` installed.

---

## 🛠️ Technology Stack

* **Backend**: FastAPI, Uvicorn, MediaPipe (Selfie Segmentation), OpenCV (`opencv-python`), NumPy.
* **Frontend**: HTML5, Vanilla CSS3 (Glassmorphism theme), Vanilla JavaScript.
* **Media Processing**: FFmpeg (used for audio-video multiplexing).

---

## 🚀 Getting Started

### 📋 Prerequisites

Ensure you have **Python 3.8+** installed.

For audio synchronization, it is recommended to have **FFmpeg** installed on your system and added to your environment `PATH` variables. (If FFmpeg is not found, the application will automatically fall back to downloading a silent version of the video without crashing).

### 🔧 Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Vedika-Goyal/ChromeCam.git
   cd ChromeCam
   ```

2. Install the required Python dependencies:
   ```bash
   pip install fastapi uvicorn mediapipe opencv-python numpy
   ```

### 💻 Running the Application

1. Start the FastAPI local server:
   ```bash
   python -m uvicorn main:app --host 127.0.0.1 --port 8080
   ```

2. Open your web browser and navigate to:
   ```text
   http://127.0.0.1:8080
   ```

3. Grant camera and microphone permissions when prompted by the browser.

---

## 🖥️ How It Works (Architecture)

1. **Client Captures Feed**: The browser accesses the user's camera stream via `getUserMedia` and extracts frame pixels onto a hidden canvas.
2. **Self-Paced Streaming**: To prevent server backpressure, a recursive loop draws frames and POSTs them as JPEG blobs to the `/process_frame` endpoint. The next frame is only sent *after* the server responds.
3. **Backend AI Blending**: FastAPI decodes the JPEG, applies a MediaPipe segmentation mask, blends the webcam foreground with the chosen background canvas, and returns the processed image.
4. **Multiplexing**: 
   * When recording, the backend appends frames to `cv2.VideoWriter`.
   * Concurrently, the frontend captures microphone input using `MediaRecorder`.
   * Upon stopping, the audio blob is uploaded to `/upload_audio` and multiplexed with the video track via FFmpeg.
5. **Download Output**: The frontend displays a **Download Recording** button that prompts the user to download the final high-quality `.mp4` video.
