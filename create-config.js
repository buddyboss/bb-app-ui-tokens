const fs = require("fs");
const path = require("path");
const {
  registerTransforms,
  transformColorModifiers,
} = require("@tokens-studio/sd-transforms");
const StyleDictionary = require("style-dictionary");

registerTransforms(StyleDictionary);

StyleDictionary.registerTransform({
  name: "color/modifiers",
  type: "value",
  transitive: true,
  matcher: (token) =>
    token.type === "color" &&
    token.$extensions &&
    token.$extensions["studio.tokens"]?.modify,
  transformer: (token) => {
    token.$extensions["studio.tokens"].modify = {
      ...(token.$extensions["studio.tokens"]?.modify || {}),
      format: "hex",
    };
    return transformColorModifiers(token);
  },
});

const configBase = (file) => ({
  source: [`tokens/setup.json`, `tokens/brand/${file}.json`],
  platforms: {
    json: {
      transforms: ["color/modifiers", "name/cti/camel"],
      buildPath: `tokens/palettes/`,
      files: [
        {
          destination: `${file}.json`,
          format: "json",
        },
      ],
    },
  },
});

const tokensPath = "./tokens";
const brandPath = path.join(tokensPath, "brand");
const palettesPath = path.join(tokensPath, "palettes");
const themePath = path.join(tokensPath, "theme");
const componentsPath = path.join(tokensPath, "components");

// Read all the brand files
fs.readdir(brandPath, (err, files) => {
  if (err) {
    console.error("Error reading brand directory:", err);
    return;
  }

  // Process each brand file
  files.forEach((file) => {
    const paletteFile = path.join(palettesPath, file);
    const brandName = path.parse(file).name;
    const outputFile = path.join(tokensPath, `${brandName}.json`);

    // transform brand files
    const sdBase = StyleDictionary.extend(configBase(brandName));

    sdBase.cleanAllPlatforms();
    sdBase.buildAllPlatforms();

    // Read the contents of the brand file
    fs.readFile(paletteFile, "utf8", (err, brandData) => {
      if (err) {
        console.error(`Error reading brand file ${paletteFile}:`, err);
        return;
      }

      let mergedData = {};

      // Merge theme files
      fs.readdir(themePath, (err, themeFiles) => {
        if (err) {
          console.error("Error reading theme directory:", err);
          return;
        }

        themeFiles.forEach((themeFile) => {
          const themeFilePath = path.join(themePath, themeFile);

          // Read the contents of the theme file
          fs.readFile(themeFilePath, "utf8", (err, themeData) => {
            if (err) {
              console.error(`Error reading theme file ${themeFilePath}:`, err);
              return;
            }

            const themeName = path.parse(themeFile).name;
            mergedData[themeName] = JSON.parse(themeData);
          });
        });
      });

      // Merge component files
      fs.readdir(
        componentsPath,
        { withFileTypes: true },
        (err, componentDirs) => {
          if (err) {
            console.error("Error reading components directory:", err);
            return;
          }

          componentDirs.forEach((componentDir) => {
            if (componentDir.isDirectory()) {
              const componentPath = path.join(
                componentsPath,
                componentDir.name
              );

              fs.readdir(componentPath, (err, componentFiles) => {
                if (err) {
                  console.error(
                    `Error reading component directory ${componentPath}:`,
                    err
                  );
                  return;
                }

                componentFiles.forEach((componentFile) => {
                  const componentFilePath = path.join(
                    componentPath,
                    componentFile
                  );

                  // Read the contents of the component file
                  fs.readFile(
                    componentFilePath,
                    "utf8",
                    (err, componentData) => {
                      if (err) {
                        console.error(
                          `Error reading component file ${componentFilePath}:`,
                          err
                        );
                        return;
                      }

                      const componentName = path.parse(componentFile).name;
                      mergedData[componentDir.name] =
                        mergedData[componentDir.name] || {};
                      mergedData[componentDir.name][componentName] =
                        JSON.parse(componentData);
                    }
                  );
                });
              });
            }
          });
        }
      );

      // Wait for the theme and component files to be merged
      setTimeout(() => {
        mergedData.index.palette = JSON.parse(brandData).palette;

        // Write the merged data to the output file
        fs.writeFile(
          outputFile,
          JSON.stringify(mergedData, null, 2),
          "utf8",
          (err) => {
            if (err) {
              console.error(`Error writing output file ${outputFile}:`, err);
              return;
            }

            console.log(`File ${outputFile} created successfully.`);
          }
        );
      }, 1000); // Wait for 1 second to allow merging of theme and component files
    });
  });
});
