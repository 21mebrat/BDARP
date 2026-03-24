const xss = require("xss");
const formidable = require("formidable");

const ONE_GB = 1024 * 1024 * 1024;
const PARAM_LIMIT = 1_000_000;

const xssFilter = new xss.FilterXSS({
  css: {
    whiteList: {
      "font-size": true,
      "line-height": true,
      "font-family": true,
    },
  },
  whiteList: {
    // text & structure
    p: ["style"],
    br: ["style"],
    b: ["style"],
    i: ["style"],
    em: ["style"],
    strong: ["style"],
    u: ["style"],
    ul: ["style"],
    ol: ["style"],
    li: ["style"],
    h1: ["style"],
    h2: ["style"],
    h3: ["style"],
    h4: ["style"],
    h5: ["style"],
    h6: ["style"],

    // layout
    div: ["style"],
    span: ["style"],

    // table elements
    table: ["style", "border", "cellpadding", "cellspacing", "width"],
    thead: ["style"],
    tbody: ["style"],
    tfoot: ["style"],
    tr: ["style"],
    th: ["style", "colspan", "rowspan", "align"],
    td: ["style", "colspan", "rowspan", "align"],
  },
  stripIgnoreTag: true,
  stripIgnoreTagBody: ["script", "style", "iframe", "object", "embed"],
});

function deepSanitize(input) {
  if (input == null) return input;

  if (typeof input === "string") {
    const normalized = input.normalize("NFKC").trim();
    return xssFilter.process(normalized);
  }

  if (Array.isArray(input)) {
    return input.map(deepSanitize);
  }

  if (typeof input === "object") {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = deepSanitize(v);
    }
    return out;
  }

  return input;
}



const fileUploader = (req, res, next) => {
  const contentType =
    req?.headers["content-type"] || req?.headers["Content-Type"] || "";

  if (contentType.includes("multipart/form-data")) {
    const form = new formidable.IncomingForm({
      multiples: true,
      keepExtensions: true,
      allowEmptyFiles: true,
      maxFileSize: ONE_GB, // per file
      maxTotalFileSize: ONE_GB, // total
      maxFields: PARAM_LIMIT, // max non-file fields
      maxFieldsSize: ONE_GB,
      maxFieldSize: ONE_GB,
    });

    form.parse(req, (err, fields, files) => {
      if (err) {
        throw "Error parsing form data.";
      }

      req.formFields = fields;
      req.formFiles = files;

      const hasFields =
        req.formFields &&
        ((Array.isArray(req.formFields) && req.formFields.length > 0) ||
          (typeof req.formFields === "object" &&
            Object.keys(req.formFields).length > 0) ||
          (typeof req.formFields === "string" &&
            req.formFields.trim().length > 0));

      if (hasFields) {
        try {
          req.formFields = deepSanitize(req.formFields);
        } catch (_) {
 throw "Invalid request sent."
        }
      }

      next();
    });
  } else {
    if (
      req.body &&
      typeof req.body === "object" &&
      Object.keys(req.body).length > 0
    ) {
      try {
        req.body = deepSanitize(req.body);
      } catch (_) {
throw ("Invalid request sent.")
      }
    }

    next();
  }
};

module.exports = fileUploader;
