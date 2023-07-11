const fs = require("fs");
const path = require("path");
const {
  registerTransforms,
  transformColorModifiers,
} = require("@tokens-studio/sd-transforms");
const StyleDictionary = require("style-dictionary");
// const transformObject = require("style-dictionary/lib/transform/object");

function replaceKeyWithValue(json) {
  if (typeof json !== "object") {
    return json;
  }

  if (Array.isArray(json)) {
    return json.map(replaceKeyWithValue);
  }

  const result = {};

  for (const key in json) {
    const value = json[key];

    if (
      typeof value === "object" &&
      value !== null &&
      value.$extensions &&
      value.$extensions["bb.app.ui"]?.transformed?.name
    ) {
      result[value.$extensions["bb.app.ui"]?.transformed?.name] =
        replaceKeyWithValue(value);
    } else {
      result[key] = replaceKeyWithValue(value);
    }
  }

  return result;
}

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

StyleDictionary.registerTransform({
  name: "name/modifiers",
  type: "name",
  transitive: true,
  matcher: (token) => {
    return (
      token.$extensions && token.$extensions["bb.app.ui"]?.transformed?.name
    );
  },
  transformer: (token) => {
    if (
      token.$extensions &&
      token.$extensions["bb.app.ui"]?.transformed?.name
    ) {
      return token.$extensions["bb.app.ui"]?.transformed?.name;
    }
  },
});

const configBrandSD = (file) => ({
  source: [`tokens/setup.json`, `tokens/changedBrand/${file}.json`],
  platforms: {
    json: {
      transforms: ["name/cti/camel"],
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
const brandPath = path.join(tokensPath, "changedBrand");
const palettesPath = path.join(tokensPath, "palettes");
const themePath = path.join(tokensPath, "theme");
const componentsPath = path.join(tokensPath, "components");
const defaultPalettePath = path.join(palettesPath, "default.json");

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
    const outputFile = `${brandName}.json`;

    // transform brand files
    const sdBrand = StyleDictionary.extend(configBrandSD(brandName));

    sdBrand.cleanAllPlatforms();
    sdBrand.buildAllPlatforms();

    let defaultPalette;

    fs.readFile(defaultPalettePath, "utf8", (err, defaultPaletteData) => {
      if (err) {
        console.error(`Error reading brand file ${defaultPalettePath}:`, err);
        return;
      }

      defaultPalette = defaultPaletteData;
    });

    // Read the contents of the brand file
    fs.readFile(paletteFile, "utf8", (err, brandData) => {
      if (err) {
        console.error(`Error reading brand file ${paletteFile}:`, err);
        return;
      }

      let mergedData = { components: {} };

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
            if (themeName === "index") {
              mergedData = Object.assign(mergedData, JSON.parse(themeData));
            } else {
              mergedData[themeName] = JSON.parse(themeData);
            }
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
                      mergedData.components[componentDir.name] =
                        mergedData.components[componentDir.name] || {};

                      if (componentName === "index") {
                        mergedData.components[componentDir.name] =
                          Object.assign(
                            mergedData.components[componentDir.name],
                            JSON.parse(componentData)
                          );
                      } else {
                        mergedData.components[componentDir.name][
                          componentName
                        ] = JSON.parse(componentData);
                      }
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
        // merge default palette with brand
        mergedData.palette = Object.assign(
          JSON.parse(defaultPalette).palette,
          JSON.parse(brandData).palette
        );
        // merge index, default and brand colors
        mergedData.color = Object.assign(
          mergedData.color,
          JSON.parse(defaultPalette).color,
          JSON.parse(brandData).color
        );

        //rename all tokens that have "name" tokens

        // Write the merged data to the output file
        fs.writeFile(
          outputFile,
          JSON.stringify(replaceKeyWithValue(mergedData), null, 2),
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
