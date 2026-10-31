import uvicorn

from .app import create_app
from .config import Settings


def main():
    settings = Settings.from_env()
    uvicorn.run(create_app(settings), host='0.0.0.0', port=settings.port, workers=1, log_level='info')


if __name__ == '__main__':
    main()
