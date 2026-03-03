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

const seedMatch = readme.match(/<!-- seed: (\d+) -->/);

let board = stateMatch ? parseState(stateMatch[1]) : generateSolvableBoard(8);
let moves = movesMatch ? parseInt(movesMatch[1], 10) : 0;
let seed = seedMatch ? parseInt(seedMatch[1], 10) : generateSeed();

if (action === "new") {
  const numMoves = parseInt(args[1] || "8", 10);
  board = generateSolvableBoard(numMoves);
  moves = 0;
  seed = generateSeed();
  console.log(`New game with ${numMoves} moves`);
} else if (action === "move") {
  const r = parseInt(args[1], 10);
  const c = parseInt(args[2], 10);
  board = applyMove(board, r, c);
  moves++;
  console.log(`Move (${r},${c}) — commits: ${moves}`);
}

const won = action !== "new" && isWin(board);
const section = renderGameSection(board, moves, won, FUNCTION_URL, seed);

const updated = readme.replace(
  /<!-- interactive game -->[\s\S]*?<!-- \/interactive game -->/,
  section
);

fs.writeFileSync(README_PATH, updated);
console.log(`README.md updated`);
