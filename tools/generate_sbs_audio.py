import asyncio
import os
import re
import sys
import yaml
import edge_tts

YAML_PATH = "/Users/michael/GitHub/most-frequent-technology-english-words/_data/side_by_side_1.yml"
AUDIO_BASE_DIR = "source/english/side-by-side-1/audio"
VOICE = "en-US-JennyNeural"
RATE = "-4%"

with open(YAML_PATH, "r", encoding="utf-8") as f:
    lessons = yaml.safe_load(f)

async def generate_audio_file(text, output_path):
    if os.path.exists(output_path) and os.path.getsize(output_path) > 500:
        return
    # Clean text
    clean = text.strip()
    communicate = edge_tts.Communicate(clean, VOICE, rate=RATE)
    await communicate.save(output_path)

async def main():
    os.makedirs(AUDIO_BASE_DIR, exist_ok=True)
    tasks = []
    
    for item in lessons:
        lesson_num = f"{item['lesson']:02d}"
        lesson_audio_dir = os.path.join(AUDIO_BASE_DIR, f"lesson-{lesson_num}")
        os.makedirs(lesson_audio_dir, exist_ok=True)
        
        for idx, vocab in enumerate(item.get("vocabulary", [])):
            word_idx = f"{idx + 1:03d}"
            word_text = vocab.get("word", "").strip()
            example_text = vocab.get("example", "").strip()
            
            word_file = os.path.join(lesson_audio_dir, f"w-{word_idx}.mp3")
            example_file = os.path.join(lesson_audio_dir, f"e-{word_idx}.mp3")
            
            if word_text:
                tasks.append(generate_audio_file(word_text, word_file))
            if example_text:
                tasks.append(generate_audio_file(example_text, example_file))
                
    print(f"Total audio files to generate: {len(tasks)}")
    
    # Run with concurrency
    sem = asyncio.Semaphore(10)
    async def sem_task(task):
        async with sem:
            await task

    await asyncio.gather(*(sem_task(t) for t in tasks))
    print("Audio generation complete!")

if __name__ == "__main__":
    asyncio.run(main())
