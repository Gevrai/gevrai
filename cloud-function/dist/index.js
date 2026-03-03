"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const ff = __importStar(require("@google-cloud/functions-framework"));
const rest_1 = require("@octokit/rest");
const BOARD_SIZE = 5;
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
function parseState(stateStr) {
    return stateStr.split("-").map((row) => row.split("").map(Number));
}
function serializeState(board) {
    return board.map((row) => row.join("")).join("-");
}
function applyMove(board, r, c) {
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
function isWin(board) {
    return board.every((row) => row.every((cell) => cell === 0));
}
function generateSolvableBoard() {
    let board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
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
function renderGameSection(board, moves, won, functionUrl) {
    const state = serializeState(board);
    let lines = [];
    lines.push("<!-- interactive game -->");
    lines.push(`<!-- state: ${state} -->`);
    lines.push(`<!-- moves: ${moves} -->`);
    if (won) {
        lines.push("");
        lines.push(`### 🎉 You solved it in ${moves} moves!`);
        lines.push("");
        lines.push(`[🆕 New Game](${functionUrl}/?action=new)`);
    }
    else {
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
        lines.push(`**Moves: ${moves}** | [🔄 Reset](${functionUrl}/?action=reset) | [🆕 New Game](${functionUrl}/?action=new)`);
    }
    lines.push("<!-- /interactive game -->");
    return lines.join("\n");
}
async function processRequest(octokit, r, c, action, functionUrl) {
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
    if (!stateMatch)
        return null;
    let board = parseState(stateMatch[1]);
    let moves = movesMatch ? parseInt(movesMatch[1], 10) : 0;
    if (action === "new") {
        board = generateSolvableBoard();
        moves = 0;
    }
    else if (action === "reset") {
        board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
        moves = 0;
    }
    else if (r !== null && c !== null) {
        board = applyMove(board, r, c);
        moves++;
    }
    const won = action !== "reset" && isWin(board);
    const newSection = renderGameSection(board, moves, won, functionUrl);
    const updatedContent = readmeContent.replace(/<!-- interactive game -->[\s\S]*?<!-- \/interactive game -->/, newSection);
    return { content: updatedContent, sha };
}
ff.http("lightsOut", async (req, res) => {
    if (!process.env.GITHUB_TOKEN || !OWNER || !REPO) {
        res.status(500).send("Missing required env vars: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO");
        return;
    }
    const octokit = new rest_1.Octokit({ auth: process.env.GITHUB_TOKEN });
    const rParam = req.query.r;
    const cParam = req.query.c;
    const action = req.query.action || null;
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
        }
        catch (err) {
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
