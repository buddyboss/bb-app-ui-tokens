/*
 * Copyright 2017 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance with
 * the License. A copy of the License is located at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
 * CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions
 * and limitations under the License.
 */

const _ = require("style-dictionary/lib/utils/es6_"),
  GroupMessages = require("style-dictionary/lib/utils/groupMessages"),
  usesReference = require("style-dictionary/lib/utils/references/usesReference"),
  getName = require("style-dictionary/lib/utils/references/getName"),
  getPath = require("style-dictionary/lib/utils/references/getPathFromName"),
  createReferenceRegex = require("style-dictionary/lib/utils/references/createReferenceRegex"),
  resolveReference = require("style-dictionary/lib/utils/references/resolveReference");

const PROPERTY_REFERENCE_WARNINGS =
  GroupMessages.GROUP.PropertyReferenceWarnings;

let current_context = []; // To maintain the context to be able to test for circular definitions
const defaults = {
  ignoreKeys: ["original"],
  ignorePaths: [],
};
let updated_object, regex, options;

function resolveObject(object, opts) {
  options = Object.assign({}, defaults, opts);

  updated_object = _.cloneDeep(object); // This object will be edited

  regex = createReferenceRegex(options);

  if (typeof object === "object") {
    current_context = [];
    return traverseObj(updated_object);
  } else {
    throw new Error("Please pass an object in");
  }
}

const isReference = (value) =>
  typeof value === "string" && value.startsWith("{") && value.endsWith("}");

const hasModifier = (value) => !!value?.$extensions?.["studio.tokens"]?.modify;

function traverseObj(obj) {
  let key;

  for (key in obj) {
    if (!obj.hasOwnProperty(key)) {
      continue;
    }

    // Append custom values
    if (
      typeof obj[key] === "object" &&
      obj[key]?.$extensions?.["bb.app.ui"]?.customValues
    ) {
      obj[key].value = {
        ...obj[key].value,
        ...obj[key]?.$extensions?.["bb.app.ui"]?.customValues,
      };
    }

    // Replace key with name attribute
    if (
      typeof obj[key] === "object" &&
      obj[key]?.$extensions?.["bb.app.ui"]?.transformed?.name
    ) {
      const { $extensions, ...rest } = obj[key];
      obj[$extensions["bb.app.ui"]?.transformed?.name] = rest;
      delete obj[key];
    }

    // Split fontWeight into fontWeight and fontStyle
    if (key === "fontWeight" && isReference(obj[key].value)) {
      const fontValue = obj[key].value.slice(1, -1); // Remove curly braces {}
      const [, , fontWeight, fontStyle] = fontValue.split(".");
      obj.fontWeight = {
        value: fontWeight,
        type: "fontWeights",
      };
      obj.fontStyle = {
        value: fontStyle,
        type: "fontStyles",
      };
    }

    // Remove base from font
    if (key === "fontFamily" && isReference(obj[key].value)) {
      const fontValue = obj[key].value.slice(1, -1); // Remove curly braces {}
      let path = fontValue.split(".");
      if (path[path.length - 1] === "base") {
        path.pop();
      }

      obj.fontFamily = {
        value: `{${path.join(".")}}`,
        type: "fontFamily",
      };
    }

    if (typeof obj[key] === "object") {
      // Remove all that have ignore
      if (
        obj[key]?.$extensions?.["bb.app.ui"]?.transformed?.ignore === "true"
      ) {
        delete obj[key];
        continue;
      }
      // Don't resolve those that are not marked as resolve: "true"
      if (
        typeof obj[key]?.$extensions?.["bb.app.ui"]?.transformed?.resolve !==
          "undefined" &&
        obj[key]?.$extensions?.["bb.app.ui"]?.transformed?.resolve !== "true"
      ) {
        continue;
      }
    }

    // We want to check for ignoredKeys, this is to
    // skip over attributes that should not be
    // mutated, like a copy of the original property.
    if (options.ignoreKeys && options.ignoreKeys.indexOf(key) !== -1) {
      continue;
    }

    current_context.push(key);
    if (typeof obj[key] === "object") {
      traverseObj(obj[key]);
    } else {
      if (
        typeof obj[key] === "string" &&
        obj[key].indexOf("{") > -1 &&
        hasModifier(obj) // don't resolve references that don't have modifiers
      ) {
        obj[key] = compile_value(obj[key], [getName(current_context)]);
      }
    }
    current_context.pop();
  }

  return obj;
}

let foundCirc = {};
function compile_value(value, stack) {
  let to_ret = value,
    ref;

  // Replace the reference inline, but don't replace the whole string because
  // references can be part of the value such as "1px solid {color.border.light}"
  value.replace(regex, function (match, variable) {
    variable = variable.trim();

    // Find what the value is referencing
    const pathName = getPath(variable, options);
    const context = getName(current_context, options);
    const refHasValue = pathName[pathName.length - 1] === "value";

    if (refHasValue && options.ignorePaths.indexOf(variable) !== -1) {
      return value;
    } else if (
      !refHasValue &&
      options.ignorePaths.indexOf(`${variable}.value`) !== -1
    ) {
      return value;
    }

    stack.push(variable);

    ref = resolveReference(pathName, updated_object);

    // If the reference doesn't end in 'value'
    // and
    // the reference points to someplace that has a `value` attribute
    // we should take the '.value' of the reference
    // per the W3C draft spec where references do not have .value
    // https://design-tokens.github.io/community-group/format/#aliases-references
    if (!refHasValue && ref && ref.hasOwnProperty("value")) {
      ref = ref.value;
    }

    if (typeof ref !== "undefined") {
      if (typeof ref === "string" || typeof ref === "number") {
        to_ret = value.replace(match, ref);

        // Recursive, therefore we can compute multi-layer variables like a = b, b = c, eventually a = c
        if (usesReference(to_ret, regex)) {
          var reference = to_ret.slice(1, -1);

          // Compare to found circular references
          if (foundCirc.hasOwnProperty(reference)) {
            // If the current reference is a member of a circular reference, do nothing
          } else if (stack.indexOf(reference) !== -1) {
            // If the current stack already contains the current reference, we found a new circular reference
            // chop down only the circular part, save it to our circular reference info, and spit out an error

            // Get the position of the existing reference in the stack
            var stackIndexReference = stack.indexOf(reference);

            // Get the portion of the stack that starts at the circular reference and brings you through until the end
            var circStack = stack.slice(stackIndexReference);

            // For all the references in this list, add them to the list of references that end up in a circular reference
            circStack.forEach(function (key) {
              foundCirc[key] = true;
            });

            // Add our found circular reference to the end of the cycle
            circStack.push(reference);

            // Add circ reference info to our list of warning messages
            GroupMessages.add(
              PROPERTY_REFERENCE_WARNINGS,
              "Circular definition cycle:  " + circStack.join(", ")
            );
          } else {
            to_ret = compile_value(to_ret, stack);
          }
        }
        // if evaluated value is a number and equal to the reference, we want to keep the type
        if (typeof ref === "number" && ref.toString() === to_ret) {
          to_ret = ref;
        }
      } else {
        // if evaluated value is not a string or number, we want to keep the type
        to_ret = ref;
      }
    } else {
      GroupMessages.add(
        PROPERTY_REFERENCE_WARNINGS,
        "Reference doesn't exist: " +
          context +
          " tries to reference " +
          variable +
          ", which is not defined"
      );
      to_ret = ref;
    }
    stack.pop(variable);

    return to_ret;
  });

  return to_ret;
}

module.exports = resolveObject;
