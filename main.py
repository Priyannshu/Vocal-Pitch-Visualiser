import os
import yt_dlp
import subprocess
import torch
import sys
import shutil

# --- CONFIGURATION ---
# Ensure this path is correct for your system
FFMPEG_PATH = r"C:\Users\priya\Downloads\ffmpeg-master-latest-win64-gpl\ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe"
DOWNLOAD_FOLDER = os.path.join(os.getcwd(), "downloads")
FINAL_OUTPUT_FOLDER = os.path.join(os.getcwd(), "Background Tracks")
TEMP_AI_FOLDER = os.path.join(os.getcwd(), "temp_ai_out")

# Create necessary directories
for folder in [DOWNLOAD_FOLDER, FINAL_OUTPUT_FOLDER, TEMP_AI_FOLDER]:
    if not os.path.exists(folder): os.makedirs(folder)


def get_best_device():
    try:
        if torch.cuda.is_available(): return "cuda"
    except:
        pass
    return "cpu"


def process_url(url):
    device = get_best_device()

    # Updated options to fix HTTP 403 Forbidden
    ydl_opts = {
        'ffmpeg_location': FFMPEG_PATH,
        'format': 'bestaudio/best',
        'outtmpl': os.path.join(DOWNLOAD_FOLDER, '%(title)s.%(ext)s'),
        'cookies_from_browser': 'chrome',
        'quiet': False,
        'no_warnings': False,
        # Extractor args help bypass SABR streaming restrictions
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

    print(f"\n📡 Step 1: Downloading...")
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.cache.remove()  # Clears old throttled data
            info = ydl.extract_info(url, download=True)
            original_title = info.get('title', 'Unknown_Song')
            clean_title = "".join([c for c in original_title if c.isalnum() or c in (' ', '.', '_', '-')]).strip()

            # Identify the downloaded file
            downloaded_wav = ydl.prepare_filename(info).rsplit('.', 1)[0] + ".wav"
            song_folder_name = os.path.splitext(os.path.basename(downloaded_wav))[0]

    except Exception as e:
        print(f"❌ Download failed: {e}")
        return

    # 2. AI Separation
    print(f"🧬 Step 2: Extracting background track on {device.upper()}...")
    # Demucs command remains the same, but path management is improved
    cmd = [sys.executable, "-m", "demucs", "--two-stems", "vocals", "-d", device, "-o", TEMP_AI_FOLDER, downloaded_wav]

    try:
        subprocess.run(cmd, check=True)

        # 3. Path targeting based on Demucs folder structure
        source_path = os.path.join(TEMP_AI_FOLDER, "htdemucs", song_folder_name, "no_vocals.wav")
        final_file_path = os.path.join(FINAL_OUTPUT_FOLDER, f"{clean_title}.wav")

        if os.path.exists(source_path):
            shutil.copy(source_path, final_file_path)
            print(f"✅ Success! Background track saved as: {clean_title}.wav")

            # 4. CLEANUP
            print("🧹 Cleaning up...")
            if os.path.exists(downloaded_wav): os.remove(downloaded_wav)
            shutil.rmtree(TEMP_AI_FOLDER)
            os.makedirs(TEMP_AI_FOLDER)
        else:
            print(f"❌ Error: 'no_vocals.wav' not found at {source_path}")

    except Exception as e:
        print(f"❌ ERROR during extraction: {e}")


def main():
    print("=== RTX 2050 Background Music Extractor (SABR Fix Active) ===")
    while True:
        url = input("\n🎵 Paste YouTube Link (or 'quit'): ").strip()
        if url.lower() == 'quit': break
        process_url(url)


if __name__ == "__main__":
    main()