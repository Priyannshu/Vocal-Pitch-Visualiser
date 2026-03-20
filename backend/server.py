"""
VOCAL — FastAPI Backend Server

Endpoints:
  POST /separate-from-url  — accepts { "url": "<youtube link>" }
    1. Uses vocals_downloader.py logic to extract vocals
    2. Uses main.py logic to extract instrumental (bg music)
    3. Returns both as base64-encoded wav strings

Runs on port 8000. CORS enabled for localhost:3000 and localhost:5173 (Vite).
"""

import os
import sys
import base64
import shutil
import tempfile
import subprocess

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yt_dlp
import torch

# ── Configuration ────────────────────────────────────────────────────────────────

FFMPEG_PATH = r"C:\Users\priya\Downloads\ffmpeg-master-latest-win64-gpl\ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe"

app = FastAPI(title="VOCAL Backend")

# CORS — allow the Vite dev server and any localhost frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Models ───────────────────────────────────────────────────────────────────────

class SeparateRequest(BaseModel):
    url: str

class SeparateResponse(BaseModel):
    vocals: str          # base64 encoded wav
    instrumental: str    # base64 encoded wav
    format: str          # "wav"
    title: str           # song title from YouTube


# ── Helpers ──────────────────────────────────────────────────────────────────────

def get_best_device():
    try:
        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def download_audio(url: str, output_dir: str) -> tuple[str, str]:
    """
    Download audio from a YouTube URL using yt-dlp.
    Returns (path_to_wav, clean_title).
    """
    ydl_opts = {
        'ffmpeg_location': FFMPEG_PATH,
        'format': 'bestaudio/best',
        'outtmpl': os.path.join(output_dir, '%(title)s.%(ext)s'),
        'cookies_from_browser': 'chrome',
        'quiet': True,
        'no_warnings': True,
        'extractor_args': {
            'youtube': {
                'player_client': ['default', '-android_sdkless'],
                'skip': ['dash', 'hls']
            }
        },
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'wav',
        }],
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.cache.remove()
        info = ydl.extract_info(url, download=True)
        original_title = info.get('title', 'Unknown_Song')
        clean_title = "".join([
            c for c in original_title
            if c.isalnum() or c in (' ', '.', '_', '-')
        ]).strip()
        downloaded_wav = ydl.prepare_filename(info).rsplit('.', 1)[0] + ".wav"
        return downloaded_wav, clean_title


def separate_audio(wav_path: str, output_dir: str) -> tuple[str, str]:
    """
    Run Demucs separation on the downloaded wav file.
    Returns (vocals_path, instrumental_path).
    """
    device = get_best_device()
    cmd = [
        sys.executable, "-m", "demucs",
        "--two-stems", "vocals",
        "-d", device,
        "-o", output_dir,
        wav_path
    ]
    subprocess.run(cmd, check=True, capture_output=True)

    song_folder_name = os.path.splitext(os.path.basename(wav_path))[0]
    base_dir = os.path.join(output_dir, "htdemucs", song_folder_name)

    vocals_path = os.path.join(base_dir, "vocals.wav")
    instrumental_path = os.path.join(base_dir, "no_vocals.wav")

    if not os.path.exists(vocals_path):
        raise FileNotFoundError(f"vocals.wav not found at {vocals_path}")
    if not os.path.exists(instrumental_path):
        raise FileNotFoundError(f"no_vocals.wav not found at {instrumental_path}")

    return vocals_path, instrumental_path


def file_to_base64(path: str) -> str:
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('utf-8')


# ── Endpoints ────────────────────────────────────────────────────────────────────

@app.post("/separate-from-url", response_model=SeparateResponse)
async def separate_from_url(req: SeparateRequest):
    """
    Accepts a YouTube URL, downloads the audio, separates vocals and instrumental,
    and returns both as base64-encoded WAV strings.
    """
    if not req.url or not req.url.strip():
        raise HTTPException(status_code=400, detail="URL is required")

    # Create temp directories for this job
    tmp_dir = tempfile.mkdtemp(prefix="vocal_")
    download_dir = os.path.join(tmp_dir, "downloads")
    separation_dir = os.path.join(tmp_dir, "separated")
    os.makedirs(download_dir, exist_ok=True)
    os.makedirs(separation_dir, exist_ok=True)

    try:
        # 1. Download
        print(f"📡 Downloading audio from: {req.url}")
        wav_path, clean_title = download_audio(req.url, download_dir)
        print(f"✅ Downloaded: {clean_title}")

        # 2. Separate
        print(f"🧬 Separating vocals and instrumental...")
        vocals_path, instrumental_path = separate_audio(wav_path, separation_dir)
        print(f"✅ Separation complete")

        # 3. Encode to base64
        vocals_b64 = file_to_base64(vocals_path)
        instrumental_b64 = file_to_base64(instrumental_path)

        return SeparateResponse(
            vocals=vocals_b64,
            instrumental=instrumental_b64,
            format="wav",
            title=clean_title
        )

    except subprocess.CalledProcessError as e:
        raise HTTPException(status_code=500, detail=f"Separation failed: {e.stderr.decode() if e.stderr else str(e)}")
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")
    finally:
        # Cleanup temp directory
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass


@app.get("/health")
async def health():
    return {"status": "ok", "device": get_best_device()}


# ── Run ──────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
