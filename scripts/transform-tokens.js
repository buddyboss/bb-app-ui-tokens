const fs = require("fs").promises;
const path = require("path");
const { transformColorModifiers } = require("@tokens-studio/sd-transforms");
/**
 * A map that is used to change refrence notation from {} to $
 */
const referencesMap = require("../references-map.json");

const resolveObject = require("./resolveObject");
const transformObject = require("style-dictionary/lib/transform/object");
const getName = require("style-dictionary/lib/utils/references/getName");

/**
 * Checks if value contains a reference
 * @param {string} value
 * @returns boolean
 */
const isReference = (value) => value.indexOf("{") > -1;

/**
 * Changes notation from {} to $
 * Example: From {space.sm} to $sm
 * @param {string} reference - reference string
 * @param {string} removablePart - What should be removed
 * @returns Changed reference
 */
const changeReferenceNotation = (reference, removablePart) => {
  return reference.replace(/\{([a-z]+)\.([a-z]+)\}/g, (match, p1, p2) => {
    if (p1 === removablePart) {
      return `$${p2}`;
    }
    return reference;
  });
};

/**
 * Loops over the tokens and does some modifications that we were not able to do with style-dictinary.
 * Removes all the data from token and leaves only value, for tokens that are marked to be resolved.
 * Changes the refrences notation.
 * @param {*} json
 * @returns
 */
function setupTokens(json) {
  if (typeof json !== "object") {
    return json;
  }

  if (Array.isArray(json)) {
    return json.map(setupTokens);
  }

  const result = {};

  for (const key in json) {
    const token = json[key];

    if (
      typeof token === "object" &&
      !!token.value &&
      (typeof token?.$extensions?.["bb.app.ui"]?.transformed?.resolve ===
        "undefined" ||
        token?.$extensions?.["bb.app.ui"]?.transformed?.resolve === "true")
    ) {
      // Replace key with name attribute
      result[key] = token.value;
    } else if (
      key in referencesMap &&
      typeof token === "object" &&
      !!token.value &&
      isReference(token.value)
    ) {
      // Change refrence notation
      result[key] = changeReferenceNotation(token.value, referencesMap[key]);
    } else {
      result[key] = setupTokens(token);
    }
  }

  return result;
}

/**
 * Exports a tokens object with applied
 * platform transforms.
 *
 * This is useful if you want to use a style
 * dictionary in JS build tools like webpack.
 *
 * A copy of style-dictionary function: style-dictionary/lib/exportPlatform.js.
 * Changes compared to original:
 * 1. it's a stand alone function instead a static method
 * 2. it has inbuild configuration with transformers
 * 3. uses modified resolveObject function
 *
 * @param {String} platform - The platform to be exported.
 * Must be defined on the style dictionary.
 * @returns {Object}
 */
function exportPlatform(tokens) {
  // We don't want to mutate the original object
  //   const platformConfig = transformConfig(
  //     this.options.platforms[platform],
  //     this
  //   );

  // style dictionary transforms definition
  const platformConfig = {
    transforms: [
      {
        name: "color/modifiers",
        type: "value",
        transitive: true,
        matcher: (token) => {
          return (
            token.type === "color" &&
            token.$extensions &&
            token.$extensions["studio.tokens"]?.modify
          );
        },
        transformer: (token) => {
          token.$extensions["studio.tokens"].modify = {
            ...(token.$extensions["studio.tokens"]?.modify || {}),
            format: "hex",
          };
          return transformColorModifiers(token);
        },
      },
    ],
    actions: [],
  };

  let exportableResult = tokens;

  // list keeping paths of props with applied value transformations
  const transformedPropRefs = [];
  // list keeping paths of props that had references in it, and therefore
  // could not (yet) have transformed
  const deferredPropValueTransforms = [];

  const transformationContext = {
    transformedPropRefs,
    deferredPropValueTransforms,
  };

  let deferredPropCount = 0;
  let finished;

  while (typeof finished === "undefined") {
    // We keep up transforming and resolving until all props are resolved
    // and every defined transformation was executed. Remember: transformations
    // can only be executed, if the value to be transformed, has no references
    // in it. So resolving may lead to enable further transformations, and sub
    // sequent resolving may enable even more transformations - and so on.
    // So we keep this loop running until sub sequent transformations are ineffective.
    //
    // Take the following example:
    //
    // color.brand = {
    //   value: "{color.base.green}"
    // }
    //
    // color.background.button.primary.base = {
    //   value: "{color.brand.value}",
    //   color: {
    //     desaturate: 0.5
    //   }
    // }
    //
    // color.background.button.primary.hover = {
    //   value: "{color.background.button.primary.base}",
    //   color: {
    //     darken: 0.2
    //   }
    // }
    //
    // As you can see 'color.background.button.primary.hover' is a variation
    // of 'color.background.button.primary.base' which is a variation of
    // 'color.base.green'. These transitive references are solved by running
    // this loop until all properties are transformed and resolved.

    // We need to transform the object before we resolve the
    // variable names because if a value contains concatenated
    // values like "1px solid {color.border.base}" we want to
    // transform the original value (color.border.base) before
    // replacing that value in the string.
    const transformed = transformObject(
      exportableResult,
      platformConfig,
      transformationContext
    );

    // referenced values, that have not (yet) been transformed should be excluded from resolving
    const ignorePathsToResolve = deferredPropValueTransforms.map((p) =>
      getName([p, "value"])
    );
    exportableResult = resolveObject(transformed, {
      ignorePaths: ignorePathsToResolve,
    });

    const newDeferredPropCount = deferredPropValueTransforms.length;

    // nothing left to transform -> ready
    if (newDeferredPropCount === 0) {
      finished = true;
      // or deferred count doesn't go down, that means there
      // is a circular reference -> ready (but errored)
    } else if (deferredPropCount === newDeferredPropCount) {
      // if we didn't resolve any deferred references then we have a circular reference
      // the resolveObject method will find the circular references
      // we do this in case there are multiple circular references
      resolveObject(transformed);
      finished = true;
    } else {
      // neither of these things, keep going.
      deferredPropCount = newDeferredPropCount;
    }
  }

  return exportableResult;
}

const tokensPath = "./tokens";
const brandPath = path.join(tokensPath, "changedBrand");
const themePath = path.join(tokensPath, "theme");
const componentsPath = path.join(tokensPath, "components");
const defaultBrandPath = path.join(brandPath, "default.json");
const outputPath = "./transformed";

/**
 * Merges theme and components files
 * @param {object} mergedData
 */
async function mergeThemesAndComponents(mergedData) {
  // Merge theme files
  const themeFiles = await fs.readdir(themePath);

  for (const themeFile of themeFiles) {
    const themeFilePath = path.join(themePath, themeFile);
    const themeName = path.parse(themeFile).name;

    const themeData = await fs.readFile(themeFilePath, "utf8");

    if (themeName === "index") {
      Object.assign(mergedData, JSON.parse(themeData));
    } else {
      mergedData[themeName] = JSON.parse(themeData);
    }
  }

  // Merge component files
  const componentDirs = await fs.readdir(componentsPath, {
    withFileTypes: true,
  });

  for (const dirent of componentDirs) {
    if (dirent.isDirectory()) {
      const componentDir = dirent.name;
      const componentPath = path.join(componentsPath, componentDir);
      const componentFiles = await fs.readdir(componentPath);

      for (const componentFile of componentFiles) {
        const componentFilePath = path.join(componentPath, componentFile);
        const componentName = path.parse(componentFile).name;

        const componentData = await fs.readFile(componentFilePath, "utf8");

        mergedData.components[componentDir] =
          mergedData.components[componentDir] || {};

        if (componentName === "index") {
          Object.assign(
            mergedData.components[componentDir],
            JSON.parse(componentData)
          );
        } else {
          mergedData.components[componentDir][componentName] =
            JSON.parse(componentData);
        }
      }
    }
  }
}

async function main() {
  const files = await fs.readdir(brandPath);

  // Read the default brand file
  let defaultBrandData;
  try {
    defaultBrandData = await fs.readFile(defaultBrandPath, "utf8");
  } catch (err) {
    console.error(`Error reading brand file ${defaultBrandPath}:`, err);
    return;
  }

  for (const file of files) {
    const brandFile = path.join(brandPath, file);
    const brandName = path.parse(file).name;
    const outputFile = path.join(outputPath, `${brandName}.json`);

    // Read the current brand file
    let brandData;
    try {
      brandData = await fs.readFile(brandFile, "utf8");
    } catch (err) {
      console.error(`Error reading brand file ${brandFile}:`, err);
      return;
    }

    // Initialize mergedData object
    let mergedData = { components: {} };

    // Merge themes and components into mergedData
    await mergeThemesAndComponents(mergedData);

    // Merge default palette with brand
    mergedData.palette = Object.assign(
      JSON.parse(defaultBrandData).palette,
      JSON.parse(brandData).palette
    );

    // Merge index, default, and brand colors
    mergedData.color = Object.assign(
      mergedData.color,
      JSON.parse(defaultBrandData).color,
      JSON.parse(brandData).color
    );

    // Merge default and brand fonts
    mergedData.font = Object.assign(
      JSON.parse(defaultBrandData).font,
      JSON.parse(brandData).font
    );

    // Write the merged data to the output file
    try {
      await fs.writeFile(
        outputFile,
        JSON.stringify(setupTokens(exportPlatform(mergedData)), null, 2),
        "utf8"
      );
      console.log(`File ${outputFile} created successfully.`);
    } catch (err) {
      console.error(`Error writing output file ${outputFile}:`, err);
    }
  }
}

// Call the main function
main().catch((err) => {
  console.error("An error occurred:", err);
});
