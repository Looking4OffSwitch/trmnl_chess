// Check for existing active game on page load
async function checkForActiveGame() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/trmnl-state`);
        const data = await response.json();

        // If there's an active game, redirect to it
        if (data.id && data.status === 'in_progress') {
            console.log('Found active game:', data.id);
            const storedToken = localStorage.getItem(`gameToken:${data.id}`);
            const tokenParam = storedToken ? `&token=${storedToken}` : '';
            window.location.href = `game.html?gameId=${data.id}${tokenParam}`;
        }
    } catch (error) {
        console.error('Error checking for active game:', error);
    }
}

// Check on page load
checkForActiveGame();

// Global force refresh button (visible on all pages)
const forceRefreshBtn = document.getElementById('force-refresh-button');
if (forceRefreshBtn) {
    const originalLabel = forceRefreshBtn.innerHTML;
    forceRefreshBtn.addEventListener('click', async () => {
        forceRefreshBtn.disabled = true;
        forceRefreshBtn.innerHTML = '<span class="inline-flex items-center"><svg class="w-4 h-4 mr-2 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582M20 20v-5h-.581M5 4a9 9 0 0114 0M19 20a9 9 0 01-14 0"></path></svg>Forcing…</span>';
        try {
            await fetch(`${API_BASE_URL}/api/trigger-refresh`, { method: 'POST' });
        } catch (err) {
            console.error('Force refresh failed', err);
        } finally {
            forceRefreshBtn.innerHTML = originalLabel;
            forceRefreshBtn.disabled = false;
        }
    });
}

document.getElementById('player-form').addEventListener('submit', function(event) {
    event.preventDefault();
    const player1 = document.getElementById('player1').value;
    const player2 = document.getElementById('player2').value;

    fetch(`${API_BASE_URL}/api/games`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ player1, player2 }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.id) {
            if (data.writeToken) {
                localStorage.setItem(`gameToken:${data.id}`, data.writeToken);
            }
            const tokenParam = data.writeToken ? `&token=${data.writeToken}` : '';
            window.location.href = `game.html?gameId=${data.id}${tokenParam}`;
        } else {
            throw new Error(data.message || 'Could not create game.');
        }
    })
    .catch((error) => {
        console.error('Error:', error);
        alert(`Error: ${error.message}`);
    });
});
