const fs = require("fs");
const path = require("path");

// delete fonts
const bPath = "./tokens/brand";

// Read all the brand files
fs.readdir(bPath, (err, files) => {
  if (err) {
    console.error("Error reading brand directory:", err);
    return;
  }

  // Process each brand file
  files.forEach((file) => {
    const brandFile = path.join(bPath, file);
    const outputFile = path.join(bPath, `changed-${file}`);

    // Read the contents of the brand file
    fs.readFile(brandFile, "utf8", (err, brandData) => {
      if (err) {
        console.error(`Error reading brand file ${brandFile}:`, err);
        return;
      }

      let jsonData;
      try {
        jsonData = JSON.parse(brandData);
      } catch (parseError) {
        console.error(
          `Error parsing JSON in brand file ${brandFile}:`,
          parseError
        );
        return;
      }

      // Remove the "font" key and its value
      delete jsonData.font;

      // Write the modified data back to the brand file
      fs.writeFile(
        outputFile,
        JSON.stringify(jsonData, null, 2),
        "utf8",
        (err) => {
          if (err) {
            console.error(`Error writing brand file ${brandFile}:`, err);
            return;
          }

          console.log(`Font key removed from ${brandFile}.`);
        }
      );
    });
  });
});

// delete fonts
