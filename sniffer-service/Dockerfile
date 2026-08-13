# Microsoft's Playwright image ships Chromium plus every system library it
# needs already installed -- avoids hand-rolling `playwright install-deps`
# (a long list of apt packages) in a generic python:slim image.
FROM mcr.microsoft.com/playwright/python:v1.49.0-jammy
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && playwright install chromium
COPY app ./app
EXPOSE 8788
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8788"]
