import * as ff from "@google-cloud/functions-framework";
import { Octokit } from "@octokit/rest";

const BOARD_SIZE = 5;
const OWNER = process.env.GITHUB_OWNER!;
const REPO = process.env.GITHUB_REPO!;

type Board = number[][];

function parseState(stateStr: string): Board {
  return stateStr.split("-").map((row) => row.split("").map(Number));
}

function serializeState(board: Board): string {
  return board.map((row) => row.join("")).join("-");
}

function applyMove(board: Board, r: number, c: number): Board {
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

function isWin(board: Board): boolean {
  return board.every((row) => row.every((cell) => cell === 0));
}

function generateSolvableBoard(): Board {
  let board: Board = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(0)
  );
  const numMoves = 5 + Math.floor(Math.random() * 10);
  for (let i = 0; i < numMoves; i++) {
    const r = Math.floor(Math.random() * BOARD_SIZE);
    const c = Math.floor(Math.random() * BOARD_SIZE);
    board = applyMove(board, r, c);
  }
  // Ensure it's not already solved
  if (isWin(board)) {
    board = applyMove(board, 2, 2);
  }
  return board;
}

function renderGameSection(
  board: Board,
  moves: number,
  won: boolean,
  functionUrl: string
): string {
  const state = serializeState(board);
  let lines: string[] = [];
  lines.push("<!-- interactive game -->");
  lines.push(`<!-- state: ${state} -->`);
  lines.push(`<!-- moves: ${moves} -->`);

  if (won) {
    lines.push("");
    lines.push(`### 🎉 You solved it in ${moves} moves!`);
    lines.push("");
    lines.push(`[🆕 New Game](${functionUrl}/?action=new)`);
  } else {
    lines.push("| | 1 | 2 | 3 | 4 | 5 |");
    lines.push("|---|---|---|---|---|---|");
    const rowLabels = ["A", "B", "C", "D", "E"];
    for (let r = 0; r < BOARD_SIZE; r++) {
      const cells = [];
      for (let c = 0; c < BOARD_SIZE; c++) {
        const emoji = board[r][c] === 1 ? "🟡" : "⚫";
        cells.push(`[${emoji}](${functionUrl}/?r=${r}&c=${c})`);
      }
      lines.push(`| **${rowLabels[r]}** | ${cells.join(" | ")} |`);
    }
    lines.push("");
    lines.push(
      `**Moves: ${moves}** | [🔄 Reset](${functionUrl}/?action=reset) | [🆕 New Game](${functionUrl}/?action=new)`
    );
  }

  lines.push("<!-- /interactive game -->");
  return lines.join("\n");
}

async function processRequest(
  octokit: Octokit,
  r: number | null,
  c: number | null,
  action: string | null,
  functionUrl: string
): Promise<{ content: string; sha: string } | null> {
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
  if (!stateMatch) return null;

  let board = parseState(stateMatch[1]);
  let moves = movesMatch ? parseInt(movesMatch[1], 10) : 0;

  if (action === "new") {
    board = generateSolvableBoard();
    moves = 0;
  } else if (action === "reset") {
    board = Array.from({ length: BOARD_SIZE }, () =>
      Array(BOARD_SIZE).fill(0)
    );
    moves = 0;
  } else if (r !== null && c !== null) {
    board = applyMove(board, r, c);
    moves++;
  }

  const won = action !== "reset" && isWin(board);
  const newSection = renderGameSection(board, moves, won, functionUrl);

  const updatedContent = readmeContent.replace(
    /<!-- interactive game -->[\s\S]*?<!-- \/interactive game -->/,
    newSection
  );

  return { content: updatedContent, sha };
}

ff.http("lightsOut", async (req, res) => {
  if (!process.env.GITHUB_TOKEN || !OWNER || !REPO) {
    res.status(500).send("Missing required env vars: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO");
    return;
  }

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

  const rParam = req.query.r as string | undefined;
  const cParam = req.query.c as string | undefined;
  const action = (req.query.action as string | undefined) || null;

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
      const functionUrl = `${req.protocol}://${req.get("host")}`;
      const result = await processRequest(octokit, r, c, action, functionUrl);
      if (!result) {
        res.status(500).send("Failed to parse README");
        return;
      }

      await octokit.repos.createOrUpdateFileContents({
        owner: OWNER,
        repo: REPO,
        path: "README.md",
        message: action
          ? `game: ${action}`
          : `game: move (${r},${c})`,
        content: Buffer.from(result.content).toString("base64"),
        sha: result.sha,
      });

      res.redirect(302, `https://github.com/${OWNER}`);
      return;
    } catch (err: any) {
      if (err.status === 409 && attempt === 0) {
        continue; // Retry on SHA conflict
      }
      if (attempt === 1 && err.status === 409) {
        res.redirect(302, `https://github.com/${OWNER}`);
        return;
      }
      throw err;
    }
  }
});
