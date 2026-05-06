FROM python:3.12-slim

WORKDIR /app

# Install mitmproxy
RUN pip install mitmproxy --no-cache-dir

# Copy addon and config
COPY proxy/addon.py .
COPY proxy/config.py .

# Create log directory — must match LOG_DIR in addon.py
# addon.py resolves Path(__file__).parent.parent / "log"
# __file__ = /app/addon.py → parent.parent = / → LOG_DIR = /log
RUN mkdir -p /log

# Expose proxy port
EXPOSE 8080

# Run mitmproxy with addon
# Set PYTHONUNBUFFERED to see logs in real-time
ENV PYTHONUNBUFFERED=1

CMD ["mitmdump", \
     "--mode", "regular", \
     "--listen-host", "0.0.0.0", \
     "--listen-port", "8080", \
     "-s", "addon.py", \
     "--allow-hosts", "(anthropic\\.com|claude\\.ai|claudeusercontent\\.com)", \
     "-q"]
