FROM python:3.12-slim

WORKDIR /srv

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8088

# Pure-compute service. It must run with NO write credential to the ticket database;
# the TypeScript spine persists recommendations under RLS + audit.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8088"]
