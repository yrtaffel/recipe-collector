# My Cookbook (Recipe Collector)

A personal Evernote-clipper replacement just for recipes. Runs on your own computer; your data stays in the `data/` folder.

## Start it (first time)
1. Install Node.js (https://nodejs.org, the LTS version).
2. In this folder, run `npm install`, then `npm start`.
3. Open http://localhost:3000

## Install the Chrome clipper
1. Open `chrome://extensions`, turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose the `extension/` folder.
3. On any recipe page: highlight the recipe, click the 🍳 extension icon, pick a category, click **Clip my selection**.
   - **Auto-detect recipe** grabs the clean ingredients/instructions most recipe sites publish.
   - **Clip whole page** is the fallback.

## What's in the app
- Categories: add, rename (✎), delete (×), reorder by dragging.
- Drag any recipe card onto a category in the sidebar to file it.
- New recipe by hand: paste text, links, or screenshots. Plain text is fine.
- Import photos: drop images, a folder, or a Google Takeout `.zip`. Each photo becomes a card (in Unsorted, or the category you pick). Album folder names become the "cookbook" name.

## Getting Google Photos albums in
Google Photos no longer allows apps to read your albums directly. Use Google Takeout (takeout.google.com): choose Google Photos, select just the cookbook albums, download the `.zip`, and drop it on the Import dialog.
