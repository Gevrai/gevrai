# Lights Out - GitHub Profile Game

A [Lights Out](https://en.wikipedia.org/wiki/Lights_Out_(game)) puzzle playable directly from a GitHub profile README. Each move is a commit to the repo, updating the board state in the README.

## The Game

- **Board:** 5x5 grid of cells displayed as bug emojis (🐛 🪲 🦗 🪳 🐜) and black squares (⬛)
- **Goal:** Turn off all the bugs
- **Mechanic:** Clicking a cell toggles it and its 4 neighbors (up, down, left, right)
- **Difficulty levels:**
  - 🌱 Greenfield project (3 moves to solve)
  - 🏢 Day job (7 moves)
  - 🏚️ Legacy codebase (15 moves)

## How It Works

1. Player clicks a cell link in the README
2. The link hits a Google Cloud Function with the row/column coordinates
3. The function fetches the current README from GitHub, applies the move, and commits the updated board
4. Player is redirected back to the GitHub profile to see the result

Game state (board, move count, seed) is stored in HTML comments within the README.

## Setup

### Prerequisites

- Google Cloud project with billing enabled
- GitHub Personal Access Token with `repo` scope
- `gcloud` CLI installed and authenticated
- Node.js 22+

### Deploy

```bash
npm install
./deploy.sh
```

The script will:
1. Enable required GCP services (Cloud Functions, Cloud Run, Cloud Build, Secret Manager)
2. Store your GitHub token in Secret Manager
3. Build and deploy the function to `us-east1`

You'll be prompted for your GitHub PAT on first run.

### Local Preview

```bash
npm run preview -- new 7        # new game with 7 moves to solve
npm run preview -- move 2 3     # click cell at row 2, col 3
npm run preview -- reset        # reset board to initial state
```

Renders the game board locally for testing without deploying.

### Configuration

Environment variables set during deployment:
- `GITHUB_OWNER` - GitHub username
- `GITHUB_REPO` - Profile repository name
- `FUNCTION_URL` - Deployed function URL (auto-set after first deploy)
- `GITHUB_TOKEN` - From Secret Manager
