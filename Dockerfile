FROM python:3.12-slim

WORKDIR /app
COPY . .

ENV TABLEPEACE_DB=/tmp/tablepeace.sqlite3
EXPOSE 10000

CMD ["sh", "-c", "python server.py --host 0.0.0.0 --port ${PORT:-10000}"]
