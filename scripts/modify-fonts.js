/**
 * This script goes through all brand files and does the font modifications
 * For example from this
 *
 * 	"font": {
 *     "plain": {
 *       "base": {
 *         "value": "SF Pro",
 *         "type": "fontFamily"
 *       },
 *       "300": {
 *         "normal": {
 *           "value": "Regular",
 *           "type": "fontWeight"
 *         },
 *         "italic": {
 *           "value": "Regular Italic",
 *           "type": "fontWeight"
 *         }
 *       }
 *     }
 *  },
 *
 *  makes this:
 *
 *   "font": {
 *     "plain": {
 *       "value": "SF Pro",
 *       "type": "fontFamily"
 *     }
 *   },
 *
 * The result is placed in changedBrand folder which gets discarded after CI complets
 */

const fs = require("fs");
const path = require("path");

// delete fonts
const bPath = "./tokens/brand";
const bChangedPath = "./tokens/changedBrand";

// Read all the brand files
fs.readdir(bPath, (err, files) => {
  if (err) {
    console.error("Error reading brand directory:", err);
    return;
  }

  fs.mkdir(bChangedPath, { recursive: true }, (err) => {
    if (err) {
      console.error("Error creating directory:", err);
    } else {
      console.log("Directory created successfully.");
    }
  });

  // Process each brand file
  files.forEach((file) => {
    const brandFile = path.join(bPath, file);
    const outputFile = path.join(bChangedPath, file);

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

      for (const section in jsonData.font) {
        jsonData.font[section] = jsonData.font[section].base.value.includes(
          "system"
        )
          ? {
              value: "System",
              type: "fontFamilies",
            }
          : jsonData.font[section].base.value;
        delete jsonData.font[section].base;
        delete jsonData.font[section].normal;
        delete jsonData.font[section].italic;
      }

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
