# Gym Log

A small offline-first strength logger in the spirit of FitNotes. It runs as a web app on GitHub Pages and saves each finished session as a JSON file in a separate private repository.

- Plans: exercises, sets, target reps and rest per exercise. Starting a plan preloads every set (grayed until logged), with weights from your last session or from the plan
- Big weight/rep steppers on the next set; one tap logs it; last session shown per exercise
- Rest timer per exercise starts after every set (vibrates and beeps when done); planned and actual rest are saved with each set
- At the end: duration, session effort (RPE 1–10) and a 0–10 pain check per body area
- Works offline; sessions upload when the phone is back online
- Import a FitNotes CSV, export everything as CSV in the FitNotes format
- Run tab: a running-plan tracker (race estimate, weekly load and ACWR, plan with live pace targets, change log). Runs, plan and fitness live in `running/` of the data repository; COROS runs are added there by a scheduled Claude task
- "Review this workout" on every run and gym session: builds a structured prompt with the session, laps, earlier comparable sessions and the week's load, and hands it to Claude (share sheet, claude.ai or the desktop app, or copy)

No data is stored in this repository. The GitHub token lives only in the phone's browser storage.
