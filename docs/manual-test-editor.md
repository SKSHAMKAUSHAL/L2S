# Manual Test Checklist: Caption Editor (Step 4)

This checklist verifies the Caption Editor UI and fast re-render flow click-by-click.

---

## Prerequisites
1. Ensure the server is running:
   ```bash
   node src/server.js
   ```
2. Open `http://localhost:3000` in Google Chrome or any modern browser.
3. Have at least one processed video job with rendered clips in `output/` (or run a quick clip generation).

---

## Test Steps

### 1. Opening the Caption Editor Modal
- [ ] Navigate to the Review Clips or Rendered Clips section.
- [ ] Click the **"Edit captions"** (or **"✏️ Edit"**) button on a clip card.
- [ ] **Expected Result:** The Creative Studio & Caption Customizer modal opens (`#editor-modal`).
- [ ] **Expected Result:** The left panel loads the video preview with safe-zone guides and HTML caption overlay.
- [ ] **Expected Result:** The right panel displays:
  - 8 Preset Chips (`Hormozi`, `Neon`, `Karaoke`, `Minimal`, `Box`, `Cinematic`, `Pop`, `Underline`).
  - Typography controls (Font Family, Font Size slider, Active Word color, Base Text color, Text Case buttons).
  - Vertical Position slider with safe-zone compliance indicator.
  - **"Word-by-Word Caption Editor"** containing the word count, Find & Replace tool, and editable caption rows.

### 2. Live Word Editing and Seeking
- [ ] In the Word-by-Word Caption Editor, click on a time badge (e.g. `[0:04.2]`).
- [ ] **Expected Result:** The video player immediately seeks to that exact timestamp.
- [ ] Edit a word in any input box (e.g., change "world" to "universe").
- [ ] **Expected Result:** The HTML caption overlay on the video updates in real time to show the edited word.
- [ ] Click the red `×` button next to a word.
- [ ] **Expected Result:** The word is removed from the transcript list and the word count decrements.

### 3. Find and Replace Across All Clips
- [ ] Type a target word in the **Find text...** input (e.g. `youtube`).
- [ ] Type a replacement word in the **Replace with...** input (e.g. `Shorts`).
- [ ] Click **"Replace in All Clips"**.
- [ ] **Expected Result:** A toast notification appears: `Replaced: N words updated across all clips!`.
- [ ] **Expected Result:** The current editor list refreshes with the updated word.

### 4. Dirty State Guard & Keyboard Shortcuts
- [ ] Make an edit in a word input box without clicking Save.
- [ ] Press the `Escape` key on the keyboard (or click Cancel / Close button).
- [ ] **Expected Result:** A confirmation prompt appears: *"You have unsaved caption edits. Are you sure you want to exit without saving?"*.
- [ ] Click Cancel on the prompt -> The modal remains open.
- [ ] Press `Ctrl+S` (or `Cmd+S` on macOS).
- [ ] **Expected Result:** The captions are saved via `PUT /api/clips/:jobId/:clipIndex/captions`, toast says *"Captions saved successfully!"*, and dirty flag clears.
- [ ] Press `Escape` now -> Modal closes cleanly without prompting.

### 5. Fast Clip Re-Render
- [ ] Re-open the editor on a clip.
- [ ] Change the caption preset to `Neon` or edit a prominent word.
- [ ] Click the **"🚀 Apply & Re-Render Clip"** button.
- [ ] **Expected Result:** The button changes state to `⏳ Re-rendering...` and becomes disabled.
- [ ] **Expected Result:** Only the ASS subtitles are regenerated and burned onto the cut clip with FFmpeg (no re-downloading or re-transcribing).
- [ ] **Expected Result:** When complete, toast says `Clip N re-rendered successfully!`, button returns to normal, and the video player reloads with the updated file URL displaying the new burned captions.
- [ ] **Expected Result:** In the Results card list on the main page, the clip video player also updates to the newly rendered video.

### 6. Concurrency Protection
- [ ] Open two tabs or send simultaneous re-render requests via curl.
- [ ] **Expected Result:** One proceeds with encoding, the second receives `409 Conflict: Re-render already in progress for this clip`.
