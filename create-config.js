const fs = require("fs");
const path = require("path");

function readJSONFilesFromFolder(folderPath) {
  const files = fs.readdirSync(folderPath);
  const jsonFiles = files;
  //   .filter((file) => file.endsWith(".json"));

  const result = {};

  jsonFiles.forEach((file) => {
    const filePath = path.join(folderPath, file);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      const folderName = path.basename(file);
      result[folderName] = readJSONFilesFromFolder(filePath);
    } else {
      const content = fs.readFileSync(filePath, "utf8");
      const fileName = file.replace(".json", "");

      if (fileName.startsWith("@") || fileName.startsWith("_")) {
        result[fileName] = JSON.parse(content);
      } else {
        if (!result.base) {
          result.base = {};
        }
        result.base[fileName] = JSON.parse(content);
      }
    }
  });

  return result;
}

function mergeJSONFilesFromFolders(folders) {
  const result = {};

  folders.forEach((folder) => {
    const folderPath = path.join(tokensFolderPath, folder);
    const folderName = path.basename(folder);

    result[folderName] = readJSONFilesFromFolder(folderPath);
  });

  return result;
}

// Example usage
const tokensFolderPath = "./tokens"; // Replace with the full path to the "tokens" folder
const folders = ["components", "setup", "theme"];
const mergedJSON = mergeJSONFilesFromFolders(folders);

// Save the merged JSON object to config.json
fs.writeFileSync("config.json", JSON.stringify(mergedJSON, null, 2));

console.log("config.json file saved successfully.");
