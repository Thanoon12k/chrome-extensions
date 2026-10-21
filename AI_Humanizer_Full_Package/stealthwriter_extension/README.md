# StealthWriter Auto Bridge (Chrome extension)

Runs the DOCX Rephrase Workbench queue through StealthWriter for you:

1. It asks the workbench for the next pending chunk.
2. It pastes the text into StealthWriter and clicks **Humanize**.
3. It waits until the output stops changing.
4. It sends the result back. The workbench puts each paragraph into its original
   place in the output DOCX and saves the file.
5. It waits a few seconds, then does the next chunk until the queue is empty.

Headings, captions, equations, lists and References are never sent (same rules as the workbench).

## Install

1. Open `chrome://extensions` and switch on **Developer mode** (top right).
2. Click **Load unpacked** and select this `stealthwriter_extension` folder.
3. Pin the extension (puzzle icon → pin).

## Use

1. Start the workbench (`RUN.bat`). At the bottom it shows
   `Extension bridge: listening on http://127.0.0.1:8765`.
2. Browse to your DOCX and click **Load / Scan**.
3. Open StealthWriter in Chrome, log in, and open the Humanizer page.
   A purple **StealthWriter Auto Bridge** panel appears in the bottom-right corner.
4. Click **▶ Start** on the panel (or in the extension popup).
5. Watch the progress. **■ Stop** stops at any time, and you can press Start again later
   to continue from where it stopped.

## If it can't find StealthWriter's boxes

StealthWriter changes its page from time to time, so the extension finds elements on its own:

- **Input:** the first large editable text box.
- **Button:** a button with the text *Humanize / Rewrite / Rephrase / Bypass*.
- **Output:** the page element whose new text best matches the length of what was sent.

If it picks the wrong element, use **Pick input**, **Pick button** or **Pick output** on the panel,
then click the correct element on the page. The selector is saved.
In the popup, **Test detection** outlines what it found: green = input, blue = button, orange = output.
**Reset selectors** in the popup goes back to finding elements on its own.

## Paragraph safety

A chunk is sent with a blank line between paragraphs. If StealthWriter returns a different
number of paragraphs, the popup setting decides what happens:

- **Redo paragraph by paragraph** (default): sends each paragraph on its own.
- **Skip the item**: marks the item as skipped in the workbench.
- **Stop**: stops so you can fix the item by hand.

## Settings (popup → Settings)

| Setting | Default | Meaning |
|---|---|---|
| Delay | 6 s | Pause between requests |
| Timeout | 180 s | Longest wait for StealthWriter's output |
| Stable | 3 s | How long the output must stay unchanged before it counts as finished |
| Stop after N errors | 3 | Stops when you run out of words or credits, or get logged out |

## Privacy

The workbench only listens on `127.0.0.1` and refuses requests from ordinary websites.
You can switch extension access off with the **Allow StealthWriter extension** checkbox in the workbench.
