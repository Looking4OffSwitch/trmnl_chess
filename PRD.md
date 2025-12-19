# Product Requirements Document: `trmnl_chess`

### 1. Overview

`trmnl_chess` is a two-player chess game designed for the `trmnl` e-ink display. The unique challenge of the `trmnl` hardware is its lack of user input. This project overcomes that limitation by using a "split-screen" approach: the `trmnl` device acts as the game board display, while all user interactions (like making moves) are handled through a simple, mobile-friendly website accessed via QR codes.

The core gameplay loop is as follows: a player scans a QR code on the `trmnl` screen, makes a move on their phone, and the `trmnl` display automatically updates to show the new board state.

### 2. System Architecture

The project consists of two primary components:

*   **`trmnl` Plugin (`trmnl_chess` folder):** A standard `trmnl` plugin written in Liquid and configured with YAML. Its sole responsibility is to display data provided by the backend. It does not contain any game logic.
*   **Web Application (`website` folder):** A web application designed to be hosted on Vercel. It includes:
    *   **Frontend:** A static HTML, CSS, and JavaScript site that serves as the user interface for player input.
    *   **Backend:** A set of serverless functions (Node.js) that manage all game logic and state.

The **source of truth** for any game is a **Game State Object** managed by the backend. This object will have the following structure:

```json
{
  "gameId": "unique-string-for-the-game",
  "players": {
    "white": "Player 1 Name",
    "black": "Player 2 Name"
  },
  "fen": "the-fen-string-representing-the-board-state",
  "turn": "white", // or "black"
  "status": "in_progress", // "in_progress", "checkmate", "stalemate", "draw", "resigned"
  "winner": null // "white", "black", or "draw"
}
```

### 3. Detailed User Flow & Functional Requirements

This section describes the application's functionality from the user's perspective, with detailed technical requirements for each step.

#### Flow 1: Starting a New Game

The initial state of the application before a game has begun.

*   **`trmnl` Plugin (Initial State):**
    *   **FR1.1:** The plugin MUST display a welcome message, e.g., "Let's Play trmnl Chess!".
    *   **FR1.2:** Below the message, it MUST display a QR code.
    *   **TR1.1 (Technical Requirement):** The QR code MUST encode a URL pointing to the "New Game" page of the hosted website (e.g., `https://trmnl-chess.vercel.app/`). This URL should be configurable.

*   **Website (New Game Page):**
    *   **FR1.3:** The page MUST contain two text input fields, one for "Player 1 Name" and one for "Player 2 Name".
    *   **FR1.4:** The page MUST provide options for players to choose their colors: "Player 1 plays White," "Player 1 plays Black," or "Assign colors randomly."
    *   **FR1.5:** The page MUST have a "Start Game" button.

*   **Backend API (`POST /api/games`):**
    *   **FR1.6:** The backend MUST expose an endpoint to create a new game. This endpoint accepts a JSON payload with `{ player1Name, player2Name, colorSelection }`.
    *   **FR1.7:** Upon receiving a request, the backend MUST:
        1.  Generate a new, unique `gameId`.
        2.  Create a new **Game State Object**, populating the player names and colors based on the user's selection.
        3.  Initialize a new game using `chess.js`, setting the `fen` to the starting position.
        4.  Store this Game State Object (e.g., in a database or a Vercel-compatible key-value store).
        5.  Return the newly created `gameId` to the website frontend.
    *   **TR1.2 (Technical Requirement):** After creating the game, the backend MUST trigger a "force refresh" of the `trmnl` plugin, providing it with the new `gameId`. (This simulates a push notification to the `trmnl` device, instructing it to fetch the new game state).

#### Flow 2: Gameplay Loop

This flow repeats for every turn until the game ends.

*   **`trmnl` Plugin (Game in Progress):**
    *   **FR2.1:** The plugin MUST display an 8x8 chessboard representing the current game state from the `fen` string.
    *   **FR2.2:** The plugin MUST display the names of both players.
    *   **FR2.3:** The plugin MUST clearly indicate whose turn it is (e.g., "White's Turn: Alice").
    *   **FR2.4:** The plugin MUST display a QR code for the current player to make their move.
    *   **TR2.1 (Technical Requirement):** This QR code MUST encode a URL pointing to the "Move Entry" page, including the `gameId` (e.g., `https://trmnl-chess.vercel.app/game/{gameId}`).

*   **Website (Move Entry Page):**
    *   **FR2.5:** The page MUST fetch the current Game State Object from the backend using the `gameId`.
    *   **FR2.6:** The page MUST display the current chessboard.
    *   **FR2.7:** The page MUST allow the player whose turn it is to select a piece and a valid destination square. The UI should prevent illegal moves.
    *   **FR2.8:** The page MUST have a "Submit Move" button.
    *   **FR2.9:** The page SHOULD have a "Resign" button.

*   **Backend API (`POST /api/games/{gameId}/moves`):**
    *   **FR2.10:** The backend MUST expose an endpoint to accept a new move. The payload should contain the move (e.g., in UCI format: `{ "from": "e2", "to": "e4" }`).
    *   **FR2.11:** The backend MUST validate the move against the game's rules using `chess.js`. If invalid, return an error to the website.
    *   **FR2.12:** If the move is valid, the backend MUST update the Game State Object with the new `fen` string and switch the `turn`.
    *   **FR2.13:** The backend MUST check for game-ending conditions (checkmate, stalemate, draw). If the game is over, it updates the `status` and `winner` fields.
    *   **TR2.2 (Technical Requirement):** The backend MUST trigger a "force refresh" of the `trmnl` plugin with the `gameId` so it can fetch the updated board state.

#### Flow 3: Game Over

The state of the application after a game has concluded.

*   **`trmnl` Plugin (Game Over State):**
    *   **FR3.1:** The plugin MUST display the final board position.
    *   **FR3.2:** The plugin MUST display a clear game-over message (e.g., "Checkmate!", "Stalemate", "Player Resigned").
    *   **FR3.3:** If there is a winner, their name MUST be prominently displayed or highlighted.
    *   **FR3.4:** The plugin MUST display a new QR code.
    *   **TR3.1 (Technical Requirement):** This QR code MUST point back to the "New Game" page on the website, allowing players to easily start a new game.

### 4. Non-Functional Requirements

*   **NFR1 (Hosting):** The entire web application (frontend and serverless backend) MUST be deployable on Vercel.
*   **NFR2 (Technology):** The project will use Liquid (`trmnl` plugin), HTML/CSS/JavaScript (frontend), and Node.js (`chess.js` library) for the serverless backend.
*   **NFR3 (Performance):** The website and API should be fast and responsive to provide a smooth user experience. The time from submitting a move on the phone to the `trmnl` screen updating should be minimal.
*   **NFR4 (Logging):** The backend API MUST include verbose logging to aid in debugging and monitoring.

### 5. Future Enhancements (Out of Scope for v1)

*   A visible game history and move list.
*   Optional time controls (e.g., Blitz, Rapid).
*   Different visual themes for the chessboard and pieces.
*   User accounts to track game history and ratings.