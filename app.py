"""Start Kosh locally or expose its ASGI app to a server."""

from backend.api import app, main

if __name__ == "__main__":
    main()
