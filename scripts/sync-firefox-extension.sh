#!/usr/bin/env bash
# Firefox on this box is a snap. Its file picker (used by "Load Temporary
# Add-on") always goes through the xdg-desktop-portal document broker, no
# matter which directory the file lives in -- the portal hands the sandbox
# access to *only the single file you clicked*, presented as if it were
# alone in an empty folder. Pointing the picker at manifest.json therefore
# lets Firefox open the manifest but not resolve any sibling file it
# references (content-script.js, service-worker.js, icons/*) -> "Unable to
# load script". A single .zip sidesteps this: it's still one file for the
# portal to hand over, but Firefox unzips it internally, so no further
# sibling-file lookups are needed. Re-run this after every extension code
# change and re-load the zip in about:debugging (Remove the old one first).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ZIP="$HOME/downloadmanager-extension.zip"

rm -f "$ZIP"
(cd "$ROOT/extension" && zip -rq -X "$ZIP" . -x ".*")
echo "Packaged to $ZIP"
echo "In Firefox: about:debugging#/runtime/this-firefox -> Remove old add-on -> Load Temporary Add-on -> $ZIP"
