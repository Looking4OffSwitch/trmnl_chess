# trmnl_chess

`trmnl_chess` is a two-player chess game that demonstrates the capabilities of the `trmnl` e-ink display. Since the `trmnl` device is for display only, all user interaction is handled through a mobile-friendly website accessed via QR codes.

The `trmnl` device displays the current state of the chessboard, while players use their smartphones to enter their moves.

## Project Structure

The project is split into two main components:

- **`/trmnl_chess`**: This directory contains the `trmnl` plugin.
  - `src/`: The Liquid templates for the plugin's UI.
  - `.trmnlp.yml`: Configuration file for the `trmnlp` local development server.
  - `bin/`: Contains the `trmnlp` executable for the local development server.
- **`/website`**: This directory contains the external web application.
  - `backend/`: The Node.js server that handles game logic and state.
  - `site/`: The static HTML/CSS/JS frontend for user interaction.

## Prerequisites

Before you begin, ensure you have the following installed on your system:

- **Ruby 3.x**: Required for the `trmnl_preview` gem. [Install Ruby](https://www.ruby-lang.org/en/documentation/installation/)
- **Node.js & npm**: The backend is a Node.js application. [Install Node.js](https://nodejs.org/)
- **Python 3**: Required to run a simple HTTP server for the frontend in the development script.
- **cURL**: Required to generate the QR code image.

**Note**: Docker is NOT required. The setup script will install the `trmnl_preview` Ruby gem automatically.

## Getting Started

To get the project up and running on your local machine for development and testing, simply run the setup script from the project root:

```bash
bash setup.sh
```

This script will check for all necessary dependencies (Ruby, Node.js, Python 3) and install the required Ruby gems and Node modules for you.

Then create your backend environment file (an example is provided):

```bash
cp website/backend/.env.example website/backend/.env
# fill in UPSTASH_REDIS_* and FRONTEND_URL (e.g., http://localhost:8000)
```

For setup, development, and production deployment see:
- `DEPLOY_WEBSITE.md` – deploying the backend/frontend to a VPS (Coolify + Docker)
- `DEPLOY_TRMNL_PLUGIN.md` – creating/pushing the TRMNL plugin and assigning it to a device

This README covers only the high-level overview and structure.
