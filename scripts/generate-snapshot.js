const fs = require("fs");
const glob = require("glob");

const snapshot = {};
const files = glob.sync("./Music/**/*.{mp3,flac,m4a,wav}");

files.forEach((file) => {
  const stats = fs.statSync(file);
  snapshot[file] = {
    mtime: stats.mtimeMs,
    size: stats.size,
    status: "processed", // Mark current files as done
  };
});

fs.writeFileSync("library_snapshot.json", JSON.stringify(snapshot, null, 2));
