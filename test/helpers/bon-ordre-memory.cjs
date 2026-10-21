"use strict";

// Double de stockage isolé : aucun test du serveur ne consomme la mémoire réelle.
function memoryFs() {
  const files = new Map();
  const handles = new Map();
  let descriptor = 0;
  const missing = () => Object.assign(new Error("Absent"), { code: "ENOENT" });
  return {
    files,
    mkdirSync() {},
    openSync(file, flags) {
      if (flags === "wx" && files.has(file)) throw Object.assign(new Error("Existe"), { code: "EEXIST" });
      files.set(file, "");
      handles.set(++descriptor, file);
      return descriptor;
    },
    writeFileSync(file, data) { files.set(handles.get(file) || file, String(data)); },
    readFileSync(file) { if (!files.has(file)) throw missing(); return files.get(file); },
    closeSync(file) { handles.delete(file); },
    fsyncSync() {},
    renameSync(from, to) { if (!files.has(from)) throw missing(); files.set(to, files.get(from)); files.delete(from); },
    unlinkSync(file) { if (!files.delete(file)) throw missing(); }
  };
}

module.exports = { memoryFs };
