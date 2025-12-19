
document.addEventListener('DOMContentLoaded', () => {
    const boardElement = document.getElementById('board');
    const turnIndicator = document.getElementById('turn-indicator');
    const moveForm = document.getElementById('move-form');
    const undoButton = document.getElementById('undo-button');
    const submitButton = document.getElementById('submit-button');
    const resignButton = document.getElementById('resign-button');
    const resetButton = document.getElementById('reset-button');
    const refreshButton = document.getElementById('refresh-button');

    // Get gameId and token from URL query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const gameId = urlParams.get('gameId');
    const urlToken = urlParams.get('token');

    if (urlToken) {
        localStorage.setItem(`gameToken:${gameId}`, urlToken);
    }

    const gameToken = localStorage.getItem(`gameToken:${gameId}`) || urlToken;

    if (!gameId) {
        alert('No game ID found in URL. Redirecting to home.');
        window.location.href = '/';
        return;
    }

    const pieceMap = {
        'r': '&#9820;', 'n': '&#9822;', 'b': '&#9821;', 'q': '&#9819;', 'k': '&#9818;', 'p': '&#9823;',
        'R': '&#9814;', 'N': '&#9816;', 'B': '&#9815;', 'Q': '&#9813;', 'K': '&#9812;', 'P': '&#9817;'
    };

    // Track selected square and pending move
    let selectedSquare = null;
    let pendingMove = null; // { from, to, piece }
    let currentGameState = null;
    let originalFen = null; // FEN before the visual move
    let validMoves = []; // Valid destination squares for selected piece
    let chess = null; // Chess instance for move validation
    let moveHistory = []; // Array of moves returned by backend
    let capturedPieces = { white: [], black: [] }; // Captured pieces by each player

    function getSquareNotation(rank, file) {
        const files = 'abcdefgh';
        const ranks = '87654321';
        return files[file] + ranks[rank];
    }

    function renderBoard(fen) {
        boardElement.innerHTML = '';
        const [boardFen] = fen.split(' ');
        const ranks = boardFen.split('/');

        for (let i = 0; i < ranks.length; i++) {
            const rank = ranks[i];
            let rankExpanded = rank.replace(/8/g, '11111111').replace(/7/g, '1111111').replace(/6/g, '111111').replace(/5/g, '11111').replace(/4/g, '1111').replace(/3/g, '111').replace(/2/g, '11');

            for (let j = 0; j < rankExpanded.length; j++) {
                const piece = rankExpanded[j];
                const square = document.createElement('div');
                const isLight = (i + j) % 2 === 0;
                square.className = `square ${isLight ? 'light' : 'dark'}`;

                // Add data attributes for square position
                const squareNotation = getSquareNotation(i, j);
                square.dataset.square = squareNotation;
                square.dataset.rank = i;
                square.dataset.file = j;

                if (piece !== '1') {
                    const pieceSpan = document.createElement('span');
                    pieceSpan.className = 'piece';
                    pieceSpan.innerHTML = pieceMap[piece] || '';
                    square.appendChild(pieceSpan);
                    square.dataset.piece = piece;
                }

                // Add click handler
                square.addEventListener('click', handleSquareClick);

                boardElement.appendChild(square);
            }
        }

        // Highlight king if in check
        highlightKingInCheck();

        console.log('Board rendered with', boardElement.children.length, 'squares');
    }

    function highlightKingInCheck() {
        if (!chess || !chess.in_check()) {
            return;
        }

        // Find the king of the current player
        const currentTurn = chess.turn();
        const kingPiece = currentTurn === 'w' ? 'K' : 'k';

        const allSquares = boardElement.querySelectorAll('.square');
        allSquares.forEach(sq => {
            if (sq.dataset.piece === kingPiece) {
                sq.classList.add('in-check');
                console.log('King in check at', sq.dataset.square);
            }
        });
    }

    function applyVisualMove(fromSquare, toSquare) {
        // Find the squares
        const allSquares = boardElement.querySelectorAll('.square');
        let fromSquareEl = null;
        let toSquareEl = null;

        allSquares.forEach(sq => {
            if (sq.dataset.square === fromSquare) {
                fromSquareEl = sq;
            } else if (sq.dataset.square === toSquare) {
                toSquareEl = sq;
            }
        });

        if (!fromSquareEl || !toSquareEl) {
            console.error('Could not find squares for move');
            return;
        }

        // Move the piece visually
        const piece = fromSquareEl.dataset.piece;
        toSquareEl.innerHTML = fromSquareEl.innerHTML;
        toSquareEl.dataset.piece = piece;

        // Clear the source square
        fromSquareEl.innerHTML = '';
        delete fromSquareEl.dataset.piece;

        console.log('Applied visual move:', fromSquare, '→', toSquare);
    }

    async function handleSquareClick(event) {
        event.preventDefault();
        event.stopPropagation();

        // Don't allow moves if game is over
        if (currentGameState && currentGameState.status !== 'in_progress') {
            return;
        }

        // If there's already a pending move, ignore clicks
        if (pendingMove) {
            console.log('Move already pending. Use Undo or Submit.');
            return;
        }

        const square = event.currentTarget;
        const squareNotation = square.dataset.square;

        console.log('Square clicked:', squareNotation, 'has piece:', square.dataset.piece);

        // First click - select a piece
        if (!selectedSquare) {
            if (square.dataset.piece) {
                // Check if this piece has any valid moves
                if (!highlightValidMoves(squareNotation)) {
                    console.log('No valid moves for piece at', squareNotation);
                    return; // Don't select pieces with no valid moves
                }

                selectedSquare = squareNotation;
                clearSquareHighlights();
                square.classList.add('selected');
                console.log('Selected piece at:', squareNotation);
            }
        } else {
            // Second click - check if it's a valid move destination first (including captures)
            const fromSquare = selectedSquare;
            const toSquare = squareNotation;

            // Check if this is a valid move
            const isValidMove = validMoves.some(m => m.to === toSquare);

            if (isValidMove) {
                // Valid move (including captures) - execute it
                console.log('Executing move from', fromSquare, 'to', toSquare);

                // Store the original FEN before making visual move
                originalFen = currentGameState.fen;

                // Apply the move visually
                applyVisualMove(fromSquare, toSquare);

                // Store the pending move
                pendingMove = {
                    from: fromSquare,
                    to: toSquare,
                    notation: fromSquare + toSquare
                };

                // Clear selection
                selectedSquare = null;
                validMoves = [];
                clearSquareHighlights();
                clearMoveHighlights();

                // Enable buttons
                undoButton.disabled = false;
                submitButton.disabled = false;

                console.log('Move ready (not submitted):', pendingMove.notation);
            } else if (square.dataset.piece && squareNotation !== selectedSquare) {
                // Not a valid move, but clicking a different piece - change selection
                console.log('Changing selection from', selectedSquare, 'to', squareNotation);

                // Check if this piece has any valid moves
                if (!highlightValidMoves(squareNotation)) {
                    console.log('No valid moves for piece at', squareNotation);
                    return; // Don't select pieces with no valid moves
                }

                selectedSquare = squareNotation;
                clearSquareHighlights();
                square.classList.add('selected');
            } else {
                // Clicking invalid empty square - do nothing
                console.log('Invalid move from', fromSquare, 'to', toSquare);
            }
        }
    }

    function getValidMovesForSquare(square) {
        if (!chess) return [];

        // Get all legal moves from this square
        const moves = chess.moves({ square: square, verbose: true });
        return moves;
    }

    function highlightValidMoves(fromSquare) {
        // Clear previous highlights
        clearMoveHighlights();

        const moves = getValidMovesForSquare(fromSquare);
        validMoves = moves;

        console.log('Valid moves from', fromSquare, ':', moves.length);

        if (moves.length === 0) {
            return false; // No valid moves
        }

        // Highlight destination squares
        const allSquares = boardElement.querySelectorAll('.square');
        allSquares.forEach(sq => {
            const sqNotation = sq.dataset.square;
            const move = moves.find(m => m.to === sqNotation);
            if (move) {
                if (move.captured) {
                    sq.classList.add('valid-capture');
                } else {
                    sq.classList.add('valid-move');
                }
            }
        });

        return true; // Has valid moves
    }

    function clearMoveHighlights() {
        const allSquares = boardElement.querySelectorAll('.square');
        allSquares.forEach(sq => {
            sq.classList.remove('valid-move', 'valid-capture');
        });
    }

    function clearSquareHighlights() {
        const allSquares = boardElement.querySelectorAll('.square');
        allSquares.forEach(sq => {
            sq.classList.remove('selected', 'destination');
        });
    }

    function clearSelection() {
        selectedSquare = null;
        validMoves = [];
        clearSquareHighlights();
        clearMoveHighlights();
    }

    /**
     * Update the move history display panel
     * Shows moves in pairs (white and black moves per row)
     */
    function updateMoveHistory() {
        const moveHistoryElement = document.getElementById('move-history');

        if (!moveHistory || moveHistory.length === 0) {
            moveHistoryElement.innerHTML = '<p class="text-sm text-gray-500 dark:text-gray-400 italic">No moves yet</p>';
            return;
        }

        let html = '<div class="space-y-1">';

        // Display moves in pairs (white, black)
        for (let i = 0; i < moveHistory.length; i += 2) {
            const moveNumber = Math.floor(i / 2) + 1;
            const whiteMove = moveHistory[i];
            const blackMove = moveHistory[i + 1];

            html += `
                <div class="flex items-center px-2 py-1 rounded move-item text-sm">
                    <span class="w-8 text-gray-500 dark:text-gray-400 font-mono">${moveNumber}.</span>
                    <span class="flex-1 text-gray-900 dark:text-white font-medium">${whiteMove?.san || ''}</span>
                    ${blackMove ? `<span class="flex-1 text-gray-900 dark:text-white font-medium">${blackMove.san}</span>` : '<span class="flex-1 text-gray-500 dark:text-gray-400 font-medium"></span>'}
                </div>
            `;
        }

        html += '</div>';
        moveHistoryElement.innerHTML = html;

        // Scroll to bottom to show latest move
        moveHistoryElement.scrollTop = moveHistoryElement.scrollHeight;
    }

    /**
     * Update captured pieces display for both players
     * Calculates material advantage based on piece values
     */
    function updateCapturedPieces() {
        if (!chess) return;

        const captured = { white: [], black: [] };

        // Captures recorded in history
        (moveHistory || []).forEach(move => {
            if (move && move.captured) {
                const symbol = move.color === 'w'
                    ? pieceMap[move.captured]
                    : pieceMap[move.captured.toUpperCase()];
                const bucket = move.color === 'w' ? 'white' : 'black';
                captured[bucket].push(symbol);
            }
        });

        // Fallback: infer missing material from current board if we have no history (older games)
        if (!moveHistory || moveHistory.length === 0) {
            const startCounts = { w: { p: 8, n: 2, b: 2, r: 2, q: 1 }, b: { p: 8, n: 2, b: 2, r: 2, q: 1 } };
            const currentCounts = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };

            chess.board().forEach(row => {
                row.forEach(square => {
                    if (square) {
                        const type = square.type;
                        currentCounts[square.color][type] += 1;
                    }
                });
            });

            ['p', 'n', 'b', 'r', 'q'].forEach(type => {
                const missingWhite = startCounts.w[type] - currentCounts.w[type];
                const missingBlack = startCounts.b[type] - currentCounts.b[type];

                for (let i = 0; i < missingWhite; i++) {
                    captured.black.push(pieceMap[type.toUpperCase()]);
                }
                for (let i = 0; i < missingBlack; i++) {
                    captured.white.push(pieceMap[type]);
                }
            });
        }

        // Update Player 1 (White) captured pieces (black pieces they captured)
        const player1CapturedElement = document.getElementById('player1-captured');
        if (captured.white.length > 0) {
            player1CapturedElement.innerHTML = captured.white.map(p =>
                `<span class="captured-piece">${p}</span>`
            ).join('');
        } else {
            player1CapturedElement.innerHTML = '<span class="text-xs text-gray-400 dark:text-gray-500">None</span>';
        }

        // Update Player 2 (Black) captured pieces (white pieces they captured)
        const player2CapturedElement = document.getElementById('player2-captured');
        if (captured.black.length > 0) {
            player2CapturedElement.innerHTML = captured.black.map(p =>
                `<span class="captured-piece">${p}</span>`
            ).join('');
        } else {
            player2CapturedElement.innerHTML = '<span class="text-xs text-gray-400 dark:text-gray-500">None</span>';
        }
    }

    /**
     * Update player name displays and turn indicators
     */
    function updatePlayerInfo() {
        if (!currentGameState) return;

        // Update player names
        document.getElementById('player1-name').textContent = currentGameState.players[0] || 'Player 1';
        document.getElementById('player2-name').textContent = currentGameState.players[1] || 'Player 2';

        // Update turn indicators and card highlights
        const player1Indicator = document.getElementById('player1-turn-indicator');
        const player2Indicator = document.getElementById('player2-turn-indicator');
        const player1Card = document.getElementById('player1-card');
        const player2Card = document.getElementById('player2-card');

        if (currentGameState.turn === 'w') {
            // White's turn
            player1Indicator.classList.remove('bg-gray-300', 'dark:bg-gray-600');
            player1Indicator.classList.add('bg-chess-dark', 'animate-pulse');
            player2Indicator.classList.remove('bg-chess-dark', 'animate-pulse');
            player2Indicator.classList.add('bg-gray-300', 'dark:bg-gray-600');

            // Highlight active player card
            player1Card.classList.add('player-active');
            player2Card.classList.remove('player-active');
        } else {
            // Black's turn
            player2Indicator.classList.remove('bg-gray-300', 'dark:bg-gray-600');
            player2Indicator.classList.add('bg-chess-dark', 'animate-pulse');
            player1Indicator.classList.remove('bg-chess-dark', 'animate-pulse');
            player1Indicator.classList.add('bg-gray-300', 'dark:bg-gray-600');

            // Highlight active player card
            player2Card.classList.add('player-active');
            player1Card.classList.remove('player-active');
        }
    }

    // Undo button - reverts the visual move
    undoButton.addEventListener('click', () => {
        if (!pendingMove) {
            return;
        }

        console.log('Undoing visual move:', pendingMove.notation);

        // Restore the original board state
        if (originalFen) {
            renderBoard(originalFen);
        }

        // Clear pending move
        pendingMove = null;
        originalFen = null;

        // Disable buttons
        undoButton.disabled = true;
        submitButton.disabled = true;

        console.log('Visual move undone');
    });

    // Resign button - current player resigns
    resignButton.addEventListener('click', async () => {
        const playerColor = currentGameState.turn === 'w' ? 'White' : 'Black';
        const confirmResign = confirm(`Are you sure you want to resign as ${playerColor}?`);

        if (!confirmResign) {
            return;
        }

        try {
            const response = await fetch(`${API_BASE_URL}/api/games/${gameId}/resign`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() }
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || 'Could not resign');
            }

            console.log('Player resigned. Winner:', result.winner);

            // Refresh the game state to show game over
            await fetchAndRenderGameState();
        } catch (error) {
            console.error('Error resigning:', error);
            alert(`Error: ${error.message}`);
        }
    });

    // Reset button - clear game and return to welcome
    if (resetButton) {
        resetButton.addEventListener('click', async () => {
            const confirmReset = confirm('Reset the current game and return to the welcome screen?');
            if (!confirmReset) return;

            resetButton.disabled = true;
            const prevLabel = resetButton.innerText;
            resetButton.innerText = 'Resetting...';

            try {
                const response = await fetch(`${API_BASE_URL}/api/reset-current`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...authHeaders() }
                });

                const result = await response.json();
                if (!response.ok) {
                    throw new Error(`${response.status} ${result.message || 'Could not reset game'}`);
                }

                // Clear token for this game (if any) and return home
                localStorage.removeItem(`gameToken:${gameId}`);
                window.location.href = '/';
            } catch (error) {
                console.error('Error resetting game:', error);
                alert(`Error: ${error.message}`);
            } finally {
                resetButton.disabled = false;
                resetButton.innerText = prevLabel;
            }
        });
    }

    // Form submission - submit the move to server
    moveForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        if (!pendingMove) {
            return;
        }

        console.log('Submitting move to server:', pendingMove.notation);

        try {
            const response = await fetch(`${API_BASE_URL}/api/games/${gameId}/moves`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({ move: pendingMove.notation })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.message || 'Invalid move');
            }

            console.log('Move accepted by server');

            // Clear pending move
            pendingMove = null;
            originalFen = null;

            // Disable buttons
            undoButton.disabled = true;
            submitButton.disabled = true;

            // Fetch and render the new state from server
            await fetchAndRenderGameState();
        } catch (error) {
            console.error('Error submitting move:', error);
            alert(`Invalid move: ${error.message}`);

            // On error, restore original board state
            if (originalFen) {
                renderBoard(originalFen);
            }
            pendingMove = null;
            originalFen = null;
            undoButton.disabled = true;
            submitButton.disabled = true;
        }
    });

    async function fetchAndRenderGameState() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/games/${gameId}`);
            if (!response.ok) {
                throw new Error('Game not found');
            }
            const gameState = await response.json();
            currentGameState = gameState;
            moveHistory = Array.isArray(gameState.history) ? gameState.history : [];

            // Initialize Chess instance for move validation
            chess = new Chess(gameState.fen);

            // Render the board
            renderBoard(gameState.fen);

            // Update all UI components
            updatePlayerInfo();
            updateMoveHistory();
            updateCapturedPieces();

            // Update game status and turn indicator
            if (gameState.status !== 'in_progress') {
                let message = `Game Over: ${gameState.status}`;
                let statusText = '';

                if (gameState.status === 'checkmate') {
                    const winnerName = gameState.winner === 'white' ? gameState.players[0] : gameState.players[1];
                    message = `Checkmate! ${winnerName} wins!`;
                    statusText = `${gameState.winner === 'white' ? 'White' : 'Black'} wins by checkmate`;
                } else if (gameState.status === 'resignation') {
                    const winnerName = gameState.winner === 'white' ? gameState.players[0] : gameState.players[1];
                    message = `${winnerName} wins`;
                    statusText = `${gameState.winner === 'white' ? 'White' : 'Black'} wins by resignation`;
                } else if (gameState.status === 'stalemate') {
                    message = 'Stalemate';
                    statusText = 'Game ended in stalemate';
                } else if (gameState.status === 'draw' || gameState.winner === 'draw') {
                    message = 'Game Drawn';
                    statusText = 'Game ended in a draw';
                }

                turnIndicator.textContent = message;
                document.getElementById('game-status-text').textContent = statusText;

                // Disable board clicks and controls
                const allSquares = boardElement.querySelectorAll('.square');
                allSquares.forEach(sq => {
                    sq.style.cursor = 'default';
                    sq.removeEventListener('click', handleSquareClick);
                });
                undoButton.disabled = true;
                submitButton.disabled = true;
                resignButton.disabled = true;
            } else {
                const turnPlayerName = gameState.turn === 'w' ? gameState.players[0] : gameState.players[1];
                const turnColor = gameState.turn === 'w' ? 'White' : 'Black';
                turnIndicator.textContent = `${turnPlayerName}'s Turn`;
                document.getElementById('game-status-text').textContent = `${turnColor} to move - Click a piece to see valid moves`;
            }
        } catch (error) {
            console.error('Error fetching game state:', error);
            alert(error.message);
        }
    }

    // Initial load
    fetchAndRenderGameState();

    // Force refresh button: fetch state and trigger TRMNL refresh
    if (refreshButton) {
        const originalLabel = refreshButton.innerHTML;
        refreshButton.addEventListener('click', async () => {
            refreshButton.disabled = true;
            refreshButton.innerHTML = '<span class="inline-flex items-center"><svg class="w-4 h-4 mr-2 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582M20 20v-5h-.581M5 4a9 9 0 01114 0M19 20a9 9 0 01-14 0"></path></svg>Forcing…</span>';

            try {
                await fetchAndRenderGameState();
                // Nudge TRMNL device via webhook
                await fetch(`${API_BASE_URL}/api/trigger-refresh`, { method: 'POST' });
            } catch (err) {
                console.error('Force refresh failed', err);
            } finally {
                refreshButton.innerHTML = originalLabel;
                refreshButton.disabled = false;
            }
        });
    }

    /**
     * Helpers
     */
    function authHeaders() {
        // Tokens no longer required; keep header if present for compatibility
        return gameToken ? { 'x-game-token': gameToken } : {};
    }
});
