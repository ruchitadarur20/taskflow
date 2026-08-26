from fastapi import FastAPI

app = FastAPI(title="TaskFlow API", version="0.1.0")


@app.get("/health/live", tags=["health"])
async def live() -> dict[str, str]:
    return {"status": "ok"}
