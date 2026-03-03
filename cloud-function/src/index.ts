import * as ff from "@google-cloud/functions-framework";
import { Octokit } from "@octokit/rest";

const BOARD_SIZE = 5;
const OWNER = process.env.GITHUB_OWNER!;
const REPO = process.env.GITHUB_REPO!;
const FUNCTION_URL = process.env.FUNCTION_URL!;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type Board = number[][];

export function parseState(stateStr: string): Board {
  return stateStr.split("-").map((row) => row.split("").map(Number));
}

function serializeState(board: Board): string {
  return board.map((row) => row.join("")).join("-");
}

export function applyMove(board: Board, r: number, c: number): Board {
  const b = board.map((row) => [...row]);
  const targets = [
    [r, c],
    [r - 1, c],
    [r + 1, c],
    [r, c - 1],
    [r, c + 1],
  ];
  for (const [tr, tc] of targets) {
    if (tr >= 0 && tr < BOARD_SIZE && tc >= 0 && tc < BOARD_SIZE) {
      b[tr][tc] ^= 1;
    }
  }
  return b;
}

export function isWin(board: Board): boolean {
  return board.every((row) => row.every((cell) => cell === 0));
}

const NUM_CELLS = BOARD_SIZE * BOARD_SIZE;
const BUG_EMOJIS = ["🐛", "🪲", "🦗", "🪳", "🐜"]

export function sanitizeSeed(raw: string): string {
  return raw.replace(/ /g, "_").replace(/[^a-zA-Z_-]/g, "").slice(0, 100);
}

export function generateSeed(): string {
  return Math.floor(Math.random() * 0xffff).toString(16);
}

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
  }
  return h;
}

// Simple seeded PRNG (mulberry32)
function seededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bugForCell(seed: string, r: number, c: number): string {
  const rng = seededRng(hashSeed(seed) + r * BOARD_SIZE + c);
  return BUG_EMOJIS[Math.floor(rng() * BUG_EMOJIS.length)];
}

export function generateSolvableBoard(numMoves: number, seed: string): Board {
  const rng = seededRng(hashSeed(seed));
  let board: Board = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(0)
  );
  numMoves = Math.max(2, Math.min(numMoves, NUM_CELLS));
  const allCells: [number, number][] = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      allCells.push([r, c]);
    }
  }
  for (let i = allCells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [allCells[i], allCells[j]] = [allCells[j], allCells[i]];
  }
  for (let i = 0; i < numMoves; i++) {
    board = applyMove(board, allCells[i][0], allCells[i][1]);
  }
  if (isWin(board)) {
    board = applyMove(board, 2, 2);
  }
  return board;
}

export function renderGameSection(
  board: Board,
  moves: number,
  won: boolean,
  functionUrl: string,
  seed: string,
  numMoves: number
): string {
  const state = serializeState(board);
  let lines: string[] = [];
  lines.push("<!-- interactive game -->");
  lines.push(`<!-- state: ${state} -->`);
  lines.push(`<!-- moves: ${moves} -->`);
  lines.push(`<!-- seed: ${seed} -->`);
  lines.push(`<!-- num_moves: ${numMoves} -->`);
  lines.push("");
  lines.push(`**Squash the bugs!**`);
  lines.push("");

  if (won) {
    lines.push("");
    lines.push(`### 🎉 All bugs squashed in ${moves} commits!`);
    lines.push("");
  } else {
    lines.push("<p>");
    for (let r = 0; r < BOARD_SIZE; r++) {
      const cells = [];
      for (let c = 0; c < BOARD_SIZE; c++) {
        const bug = bugForCell(seed, r, c);
        const emoji = board[r][c] === 1 ? bug : "⬛";
        cells.push(`<a href="${functionUrl}/?r=${r}&c=${c}">${emoji}</a>`);
      }
      const suffix = r < BOARD_SIZE - 1 ? "<br>" : "";
      lines.push(cells.join(" ") + suffix);
    }
    lines.push("</p>");
    lines.push("");
    lines.push(`**Commits: ${moves}** </br>`);
    lines.push(`[🔄 \`reset --hard main\`](${functionUrl}/?action=reset)`);
  }

  lines.push("");
  lines.push(`Commit bugfixes by clicking on squares, but each commit toggles the bug and its neighbors in the codebase!`);
  lines.push("");

  lines.push(`Fix another codebase:`);
  lines.push(`- [🌱 Greenfield project](${functionUrl}/?action=new&num_moves=3)`);
  lines.push(`- [🏢 Day job](${functionUrl}/?action=new&num_moves=7)`);
  lines.push(`- [🏚️ Legacy codebase](${functionUrl}/?action=new&num_moves=15)`);

  lines.push("<!-- /interactive game -->");
  return lines.join("\n");
}

async function processRequest(
  octokit: Octokit,
  r: number | null,
  c: number | null,
  action: string | null,
  numMoves: number,
  inputSeed: string | null,
  functionUrl: string
): Promise<{ content: string; sha: string; seed: string } | null> {
  // Fetch current README
  const { data } = await octokit.repos.getContent({
    owner: OWNER,
    repo: REPO,
    path: "README.md",
  });

  if (!("content" in data) || !("sha" in data)) {
    return null;
  }

  const readmeContent = Buffer.from(data.content, "base64").toString("utf-8");
  const sha = data.sha;

  // Parse state
  const stateMatch = readmeContent.match(/<!-- state: ([\d-]+) -->/);
  const movesMatch = readmeContent.match(/<!-- moves: (\d+) -->/);
  const seedMatch = readmeContent.match(/<!-- seed: ([a-zA-Z0-9_-]+) -->/);
  const numMovesMatch = readmeContent.match(/<!-- num_moves: (\d+) -->/);
  if (!stateMatch) return null;

  let board = parseState(stateMatch[1]);
  let moves = movesMatch ? parseInt(movesMatch[1], 10) : 0;
  let seed = seedMatch ? seedMatch[1] : generateSeed();
  let storedNumMoves = numMovesMatch ? parseInt(numMovesMatch[1], 10) : numMoves;

  if (action === "new") {
    seed = inputSeed || generateSeed();
    board = generateSolvableBoard(numMoves, seed);
    storedNumMoves = numMoves;
    moves = 0;
  } else if (action === "reset") {
    board = generateSolvableBoard(storedNumMoves, seed);
    moves = 0;
  } else if (r !== null && c !== null) {
    board = applyMove(board, r, c);
    moves++;
  }

  const won = action !== "new" && action !== "reset" && isWin(board);
  const newSection = renderGameSection(board, moves, won, functionUrl, seed, storedNumMoves);

  const updatedContent = readmeContent.replace(
    /<!-- interactive game -->[\s\S]*?<!-- \/interactive game -->/,
    newSection
  );

  return { content: updatedContent, sha, seed };
}

ff.http("lightsOut", async (req, res) => {
  if (!process.env.GITHUB_TOKEN || !OWNER || !REPO || !FUNCTION_URL) {
    res.status(500).send("Missing required env vars");
    return;
  }

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  const rParam = req.query.r as string | undefined;
  const cParam = req.query.c as string | undefined;
  const rawAction = (req.query.action as string | undefined) || null;
  const action = rawAction === "new" ? "new" : rawAction === "reset" ? "reset" : null;
  const rawNumMoves = req.query.num_moves as string | undefined;
  const numMoves = rawNumMoves ? parseInt(rawNumMoves, 10) : 8;
  const rawSeed = (req.query.seed as string | undefined) || null;
  const inputSeed = rawSeed ? sanitizeSeed(rawSeed) || null : null;

  const r = rParam !== undefined ? parseInt(rParam, 10) : null;
  const c = cParam !== undefined ? parseInt(cParam, 10) : null;

  if (r === null && c === null && !action) {
    res.status(400).send("Missing parameters");
    return;
  }

  if (r !== null && (isNaN(r) || r < 0 || r >= BOARD_SIZE)) {
    res.status(400).send("Invalid row");
    return;
  }
  if (c !== null && (isNaN(c) || c < 0 || c >= BOARD_SIZE)) {
    res.status(400).send("Invalid column");
    return;
  }

  // Try up to 2 times (retry once on SHA conflict)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await processRequest(octokit, r, c, action, numMoves, inputSeed, FUNCTION_URL);
      if (!result) {
        res.status(500).send("Failed to parse README");
        return;
      }

      await octokit.repos.createOrUpdateFileContents({
        owner: OWNER,
        repo: REPO,
        path: "README.md",
        message: action === "new"
          ? `game: new game`
          : action === "reset"
          ? `game: reset seed ${result.seed}`
          : `game: move (${r},${c})`,
        content: Buffer.from(result.content).toString("base64"),
        sha: result.sha,
      });

      await sleep(1000); // Wait a moment for GitHub to reflect the change
      res.redirect(302, `https://github.com/${OWNER}`);
      return;
    } catch (err: any) {
      if (err.status === 409 && attempt === 0) {
        continue; // Retry on SHA conflict
      }
      if (attempt === 1 && err.status === 409) {
        await sleep(1000); // Wait a moment for GitHub to reflect the change
        res.redirect(302, `https://github.com/${OWNER}`);
        return;
      }
      console.error("Unexpected error:", err);
      res.status(500).send("Something went wrong");
      return;
    }
  }
});
