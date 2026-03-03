import * as fs from "fs";
import * as path from "path";
import {
  generateSolvableBoard,
  generateSeed,
  renderGameSection,
  parseState,
  applyMove,
  isWin,
} from "./index";

const README_PATH = path.resolve(__dirname, "../../README.md");
const FUNCTION_URL = "https://lights-out-5c4srghjdq-ue.a.run.app";

const args = process.argv.slice(2);
const action = args[0] || "new"; // "new" or "move r c"

const readme = fs.readFileSync(README_PATH, "utf-8");

const stateMatch = readme.match(/<!-- state: ([\d-]+) -->/);
const movesMatch = readme.match(/<!-- moves: (\d+) -->/);

const seedMatch = readme.match(/<!-- seed: ([a-zA-Z0-9_-]+) -->/);
const numMovesMatch = readme.match(/<!-- num_moves: (\d+) -->/);

let seed = seedMatch ? seedMatch[1] : generateSeed();
let numMoves = numMovesMatch ? parseInt(numMovesMatch[1], 10) : 8;
let board = stateMatch ? parseState(stateMatch[1]) : generateSolvableBoard(8, seed);
let moves = movesMatch ? parseInt(movesMatch[1], 10) : 0;

if (action === "new") {
  numMoves = parseInt(args[1] || "8", 10);
  seed = generateSeed();
  board = generateSolvableBoard(numMoves, seed);
  moves = 0;
  console.log(`New game with ${numMoves} moves`);
} else if (action === "reset") {
  board = generateSolvableBoard(numMoves, seed);
  moves = 0;
  console.log(`Reset to initial state`);
} else if (action === "move") {
  const r = parseInt(args[1], 10);
  const c = parseInt(args[2], 10);
  board = applyMove(board, r, c);
  moves++;
  console.log(`Move (${r},${c}) — commits: ${moves}`);
}

const won = action !== "new" && action !== "reset" && isWin(board);
const section = renderGameSection(board, moves, won, FUNCTION_URL, seed, numMoves);

const updated = readme.replace(
  /<!-- interactive game -->[\s\S]*?<!-- \/interactive game -->/,
  section
);

fs.writeFileSync(README_PATH, updated);
console.log(`README.md updated`);
