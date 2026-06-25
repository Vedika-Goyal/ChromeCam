// DOM Node Bindings
const tabButtons = document.querySelectorAll('.tab-btn');
const colorPanel = document.getElementById('colorPanel');
const imagePanel = document.getElementById('imagePanel');
const colorPicker = document.getElementById('colorPicker');
const colorHex = document.getElementById('colorHex');
const swatches = document.querySelectorAll('.swatch');
const uploadArea = document.getElementById('uploadArea');
const bgImageInput = document.getElementById('bgImageInput');
const presetsGrid = document.getElementById('presetsGrid');
const recordBtn = document.getElementById('recordBtn');
const downloadBtn = document.getElementById('downloadBtn');
const processedPreview = document.getElementById('processedPreview');
const loadingOverlay = document.getElementById('loadingOverlay');
const rawWebcam = document.getElementById('rawWebcam');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const timerRow = document.getElementById('timerRow');
const timerText = document.getElementById('timerText');

// Application States
let bgType = 'color'; // 'color' or 'image'
let currentBgColor = colorPicker.value;
let currentBgImageId = null;
let isRecording = false;
let activeVideoId = null;
let isProcessing = false;
let recordingStartTime = null;
let timerIntervalId = null;

// Audio variables
let audioStream = null;
let audioRecorder = null;
let audioChunks = [];

const streamWidth = 640;
const streamHeight = 480;
const targetFps = 20;

// Offscreen buffer for frame capture
const bufferCanvas = document.createElement('canvas');
bufferCanvas.width = streamWidth;
bufferCanvas.height = streamHeight;
const ctx = bufferCanvas.getContext('2d', { willReadFrequently: true });

// 1. Tab Navigation Controls
tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const selectedMode = btn.dataset.mode;
        bgType = selectedMode;
        
        if (selectedMode === 'color') {
            colorPanel.classList.add('active');
            imagePanel.classList.remove('active');
        } else {
            colorPanel.classList.remove('active');
            imagePanel.classList.add('active');
        }
    });
});

// 2. Color Selection Controls
colorPicker.addEventListener('input', (e) => {
    updateColorState(e.target.value);
    swatches.forEach(s => s.classList.remove('active'));
});

swatches.forEach(swatch => {
    swatch.addEventListener('click', () => {
        const hexColor = swatch.dataset.color;
        colorPicker.value = hexColor;
        updateColorState(hexColor);
        
        swatches.forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
    });
});

function updateColorState(hex) {
    currentBgColor = hex;
    colorHex.textContent = hex.toUpperCase();
}

// 3. Custom Image Upload and Drag-Drop
uploadArea.addEventListener('click', () => bgImageInput.click());

bgImageInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleImageUpload(e.target.files[0]);
    }
});

// Drag over styles
['dragenter', 'dragover'].forEach(eventName => {
    uploadArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    }, false);
});

['dragleave', 'drop'].forEach(eventName => {
    uploadArea.addEventListener(eventName, (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
    }, false);
});

uploadArea.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
        handleImageUpload(files[0]);
    }
});

async function handleImageUpload(file) {
    if (!file.type.startsWith('image/')) {
        alert("Please upload a valid image file.");
        return;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch('/upload_background', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) throw new Error("Upload request failed");
        
        const data = await response.json();
        const localUrl = URL.createObjectURL(file);
        
        createEnvironmentThumbnail(data.background_id, localUrl);
        bgType = 'image';
        
        // Auto-switch tabs to show selection
        const imgTab = Array.from(tabButtons).find(b => b.dataset.mode === 'image');
        if (imgTab) imgTab.click();
        
    } catch (err) {
        console.error("Background upload failed:", err);
        alert("Could not process background image.");
    }
}

function createEnvironmentThumbnail(id, objectUrl) {
    const container = document.createElement('div');
    container.className = 'preset-item active';
    container.dataset.bgId = id;
    container.innerHTML = `<img src="${objectUrl}" alt="Virtual Environment">`;
    
    // De-activate current presets
    document.querySelectorAll('.preset-item').forEach(p => p.classList.remove('active'));
    
    container.addEventListener('click', () => {
        document.querySelectorAll('.preset-item').forEach(p => p.classList.remove('active'));
        container.classList.add('active');
        currentBgImageId = id;
        bgType = 'image';
    });
    
    presetsGrid.appendChild(container);
    currentBgImageId = id;
}

// 4. Video and Audio Stream Acquisition
async function startWebcam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: streamWidth },
                height: { ideal: streamHeight },
                frameRate: { ideal: targetFps }
            },
            audio: true // Request microphone access alongside webcam
        });
        
        rawWebcam.srcObject = stream;
        
        // Extract microphone track for independent audio recording
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length > 0) {
            audioStream = new MediaStream(audioTracks);
        }
        
        rawWebcam.onloadedmetadata = () => {
            rawWebcam.play();
            
            // Fade out and hide loading overlay
            loadingOverlay.style.opacity = '0';
            setTimeout(() => loadingOverlay.classList.add('hidden'), 400);
            
            recordBtn.disabled = false;
            statusDot.classList.add('active');
            statusText.textContent = "Active";
            
            runPipelineLoop();
        };
    } catch (err) {
        console.error("Camera/Mic interface initialization failed:", err);
        loadingOverlay.querySelector('.loading-text').textContent = "Permissions denied or hardware unavailable.";
        loadingOverlay.querySelector('.spinner').style.display = 'none';
        statusText.textContent = "Access Denied";
    }
}

// 5. Audio Recorder Setup
function setupAudioRecorder(recordingId) {
    if (!audioStream) return;
    
    audioChunks = [];
    const options = { mimeType: 'audio/webm' };
    
    try {
        audioRecorder = new MediaRecorder(audioStream, options);
    } catch (e) {
        console.warn("Fallback to default audio MediaRecorder format:", e);
        audioRecorder = new MediaRecorder(audioStream);
    }
    
    audioRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
            audioChunks.push(event.data);
        }
    };
    
    audioRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        audioChunks = [];
        
        statusText.textContent = "Processing Audio...";
        statusDot.classList.remove('active');
        recordBtn.disabled = true;
        
        await uploadAudioTrack(recordingId, audioBlob);
        
        recordBtn.disabled = false;
        statusDot.classList.add('active');
        statusText.textContent = "Active";
    };
}

async function uploadAudioTrack(recordingId, audioBlob) {
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    
    try {
        const response = await fetch(`/upload_audio?video_id=${recordingId}`, {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) throw new Error("Server audio integration failed");
        
        downloadBtn.href = `/download/${recordingId}`;
        downloadBtn.classList.remove('hidden');
    } catch (err) {
        console.error("Audio upload/merge process failed:", err);
        alert("Audio sync failed. Video will be saved as silent.");
        
        // Silent video download fallback
        downloadBtn.href = `/download/${recordingId}`;
        downloadBtn.classList.remove('hidden');
    }
}

// 6. Frame Blending Pipeline
function runPipelineLoop() {
    async function captureFrame() {
        if (!rawWebcam.paused && !rawWebcam.ended) {
            if (!isProcessing) {
                isProcessing = true;
                ctx.drawImage(rawWebcam, 0, 0, streamWidth, streamHeight);
                
                bufferCanvas.toBlob(async (blob) => {
                    if (blob) {
                        await transmitFrame(blob);
                    }
                    isProcessing = false;
                    setTimeout(captureFrame, 1000 / targetFps);
                }, 'image/jpeg', 0.85);
            } else {
                setTimeout(captureFrame, 10);
            }
        } else {
            setTimeout(captureFrame, 100);
        }
    }
    captureFrame();
}

async function transmitFrame(blob) {
    const formData = new FormData();
    formData.append('file', blob, 'frame.jpg');
    
    let path = `/process_frame?color=${encodeURIComponent(currentBgColor)}&bg_type=${bgType}`;
    if (bgType === 'image' && currentBgImageId) {
        path += `&bg_image_id=${currentBgImageId}`;
    }
    if (isRecording && activeVideoId) {
        path += `&video_id=${activeVideoId}`;
    }
    
    try {
        const response = await fetch(path, {
            method: 'POST',
            body: formData
        });
        
        if (response.ok) {
            const resultBlob = await response.blob();
            
            if (processedPreview.src && processedPreview.src.startsWith('blob:')) {
                URL.revokeObjectURL(processedPreview.src);
            }
            
            processedPreview.src = URL.createObjectURL(resultBlob);
        }
    } catch (err) {
        console.error("Frame upload failed:", err);
    }
}

// 7. Local Recording Session Management
recordBtn.addEventListener('click', async () => {
    if (!isRecording) {
        await startRecording();
    } else {
        await stopRecording();
    }
});

async function startRecording() {
    try {
        const response = await fetch(`/start_recording?width=${streamWidth}&height=${streamHeight}&fps=${targetFps}`, {
            method: 'POST'
        });
        
        if (!response.ok) throw new Error();
        const data = await response.json();
        
        activeVideoId = data.video_id;
        isRecording = true;
        
        downloadBtn.classList.add('hidden');
        downloadBtn.href = "#";
        
        recordBtn.classList.add('recording');
        recordBtn.innerHTML = `<i data-lucide="square" class="btn-icon"></i> <span>Stop Recording</span>`;
        lucide.createIcons();
        
        // Start microphone recording recorder
        setupAudioRecorder(activeVideoId);
        if (audioRecorder) {
            audioRecorder.start();
        }
        
        startTimer();
    } catch (err) {
        console.error("Recording init failure:", err);
        alert("Failed to start recording session.");
    }
}

async function stopRecording() {
    if (!activeVideoId) return;
    
    // Store current video ID for async audio processing closure
    const currentId = activeVideoId;
    
    try {
        const response = await fetch(`/stop_recording?video_id=${currentId}`, {
            method: 'POST'
        });
        
        if (!response.ok) throw new Error();
        
        isRecording = false;
        activeVideoId = null;
        
        recordBtn.classList.remove('recording');
        recordBtn.innerHTML = `<i data-lucide="video" class="btn-icon"></i> <span>Start Recording</span>`;
        lucide.createIcons();
        
        stopTimer();
        
        // Trigger audio recorder save which handles final upload
        if (audioRecorder && audioRecorder.state !== 'inactive') {
            audioRecorder.stop();
        } else {
            // Immediate fallback if mic is unavailable
            downloadBtn.href = `/download/${currentId}`;
            downloadBtn.classList.remove('hidden');
        }
    } catch (err) {
        console.error("Recording stop failure:", err);
        alert("Recording could not be finalized cleanly.");
    }
}

// 8. Timer Mechanics
function startTimer() {
    recordingStartTime = Date.now();
    timerRow.classList.remove('hidden');
    timerText.textContent = "00:00";
    
    timerIntervalId = setInterval(() => {
        const elapsed = Date.now() - recordingStartTime;
        const totalSecs = Math.floor(elapsed / 1000);
        const mins = String(Math.floor(totalSecs / 60)).padStart(2, '0');
        const secs = String(totalSecs % 60).padStart(2, '0');
        timerText.textContent = `${mins}:${secs}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
    timerRow.classList.add('hidden');
}

window.addEventListener('DOMContentLoaded', () => {
    startWebcam();
});
