// loadRvfvLineages.js
//
// Serially load RVFV lineage assignments from three TSV files under
// tabular/, declare one reference sequence per lineage per file, set
// sequence.rec_lineage for every sequence listed, and flag the chosen
// representative isolates as is_reference=TRUE in the `isolate`
// custom table.
//
// TSV columns expected:
//   isolate, year, country, source, lineage, accession
//
// Reference naming convention (current):
//   REF_<segment>_<lineage>_<strain>
//   e.g. REF_L_A_ZH-1776
//
// Legacy convention (migrated on first run):
//   REF_<lineage>_<segment>_<strain>
//   e.g. REF_A_L_ZH-1776
//
// For each lineage in a file:
//   - create reference REF_<segment>_<lineage>_<strain> from the FIRST
//     accession in that file (one representative sequence per lineage).
//
// For each row in a file:
//   - set sequence.rec_lineage = <lineage>
//
// For the representative isolate of each lineage:
//   - set isolate.is_reference = TRUE  (via custom-table-row/isolate/<id>)

var DRY_RUN = false;

// Set to true to migrate legacy REF_<lineage>_<segment>_<strain> reference
// names to REF_<segment>_<lineage>_<strain> before running the load.
var MIGRATE_LEGACY_REF_NAMES = false;

// Processed serially. Each entry maps a file to the segment letter it
// represents.
var TSV_INPUTS = [
    { path: "tabular/complete-L.Lineages.tsv", segment: "L" },
    { path: "tabular/complete-M.Lineages.tsv", segment: "M" },
    { path: "tabular/complete-S.Lineages.tsv", segment: "S" }
];

// Primary-key field name of the `isolate` custom table. In this project
// it is `id`.
var ISOLATE_KEY_FIELD = "id";

// -----------------------------------------------------------------------------
// Basic helpers
// -----------------------------------------------------------------------------

function norm(value) {
    if(value === null || value === undefined) {
        return null;
    }
    var s = ("" + value).trim();
    if(s === "") {
        return null;
    }
    var low = s.toLowerCase();
    if(low === "n/a" || low === "na" || low === "null" || low === "none") {
        return null;
    }
    return s;
}

function log(msg) {
    glue.log("INFO", msg);
}

function escapeQuotes(value) {
    return ("" + value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function queryObjects(cmdWords) {
    return glue.tableToObjects(glue.command(cmdWords));
}

function runCmd(cmdWords) {
    if(DRY_RUN) {
        log("[DRY RUN] " + cmdWords.join(" "));
        return null;
    }
    return glue.command(cmdWords);
}

function referenceExists(refName) {
    var rows = queryObjects([
        "list", "reference",
        "-w", "name = '" + escapeQuotes(refName) + "'"
    ]);
    return rows.length > 0;
}

// Sanitize a string for use as part of a reference name. Replaces '/' with
// '_' first (so it survives), then strips any remaining characters that
// are not alphanumeric, '_' or '-'.
function sanitizeForRefName(value) {
    var s = "" + value;
    s = s.replace(/\//g, "_");
    s = s.replace(/[^A-Za-z0-9_-]/g, "");
    return s;
}

// -----------------------------------------------------------------------------
// TSV parsing
// -----------------------------------------------------------------------------

function readTsv(path) {
    var Paths = java.nio.file.Paths;
    var Files = java.nio.file.Files;
    var StandardCharsets = java.nio.charset.StandardCharsets;

    var filePath = Paths.get(path);
    if(!Files.exists(filePath)) {
        throw "TSV file does not exist: " + path;
    }

    var text;
    try {
        text = new java.lang.String(
            Files.readAllBytes(filePath),
            StandardCharsets.UTF_8
        );
    } catch(e) {
        throw "Could not read TSV file: " + path + " (" + e + ")";
    }

    if(text === null || text === undefined || text === "") {
        throw "TSV file appears to be empty: " + path;
    }

    var lines = ("" + text).split(/\r?\n/);
    var header = null;
    var rows = [];

    _.each(lines, function(line) {
        if(line === null) {
            return;
        }
        if(line.trim() === "") {
            return;
        }
        var fields = line.split("\t");
        if(header === null) {
            header = fields;
            return;
        }
        var row = {};
        for(var i = 0; i < header.length; i++) {
            row[header[i]] = fields[i] !== undefined ? fields[i] : null;
        }
        rows.push(row);
    });

    if(header === null) {
        throw "TSV file appears to be empty (no header): " + path;
    }

    return rows;
}

// -----------------------------------------------------------------------------
// Sequence lookup
// -----------------------------------------------------------------------------

function findSequenceByAccession(accession) {
    var rows = queryObjects([
        "list", "sequence",
        "sequenceID",
        "source.name",
        "-w", "sequenceID = '" + escapeQuotes(accession) + "'"
    ]);
    if(rows.length === 0) {
        return null;
    }
    if(rows.length > 1) {
        log("WARNING: multiple sequences share sequenceID '" + accession +
            "'; using the first.");
    }
    return {
        sourceName: norm(rows[0]["source.name"]),
        sequenceID: norm(rows[0].sequenceID)
    };
}

// Check whether an isolate custom-table row exists for the given sequenceID.
function isolateRowExists(sequenceID) {
    var rows = queryObjects([
        "list", "custom-table-row", "isolate",
        "-w", ISOLATE_KEY_FIELD + " = '" + escapeQuotes(sequenceID) + "'"
    ]);
    return rows.length > 0;
}

// Check whether a reference exists by name, returning its row or null.
function findReferenceByName(refName) {
    var rows = queryObjects([
        "list", "reference",
        "name",
        "sequence.source.name",
        "sequence.sequenceID",
        "-w", "name = '" + escapeQuotes(refName) + "'"
    ]);
    if(rows.length === 0) {
        return null;
    }
    return rows[0];
}

// -----------------------------------------------------------------------------
// Legacy reference-name migration
// -----------------------------------------------------------------------------

// Rename a reference from one name to another, preserving the target
// sequence. GLUE's reference model has no direct "rename" command, so we
// delete and re-create under the new name.
function renameReference(oldName, newName, sourceName, sequenceID) {
    log("Renaming reference: " + oldName + " -> " + newName);

    runCmd(["delete", "reference", oldName]);
    runCmd([
        "create", "reference",
        newName,
        sourceName,
        sequenceID
    ]);
}

// Legacy names are REF_<lineage>_<segment>_<strain>. New names are
// REF_<segment>_<lineage>_<strain>. Because GLUE's `like` operator treats
// `_` as a single-character wildcard, we can't reliably pattern-match the
// old names. Instead we enumerate all references and parse the name in JS.
function migrateLegacyReferenceNames() {
    if(!MIGRATE_LEGACY_REF_NAMES) {
        return;
    }

    log("=== Migrating legacy reference names (if any) ===");

    var refs = queryObjects([
        "list", "reference",
        "name",
        "sequence.source.name",
        "sequence.sequenceID"
    ]);

    var renameCount = 0;
    var collisionCount = 0;

    _.each(refs, function(ref) {
        var name = norm(ref.name);
        if(name === null) {
            return;
        }
        // Skip master references.
        if(name.indexOf("REF_MASTER_") === 0) {
            return;
        }
        // Expect REF_<lineage>_<segment>_<strain> where lineage and segment
        // are single uppercase letters.
        var m = name.match(/^REF_([A-Z])_([LMS])_(.+)$/);
        if(m === null) {
            return;
        }
        var lineage = m[1];
        var segment = m[2];
        var strain = m[3];

        var newName = "REF_" + segment + "_" + lineage + "_" + strain;

        // Is the new name already in use? If so, skip — probably a
        // previous partial migration. We don't want to delete a reference
        // that's already correctly named.
        if(referenceExists(newName)) {
            log("Skipping " + name + " -> " + newName +
                " (target already exists; will clean up manually)");
            collisionCount++;
            return;
        }

        renameReference(
            name,
            newName,
            norm(ref["sequence.source.name"]),
            norm(ref["sequence.sequenceID"])
        );
        renameCount++;
    });

    log("Migrated " + renameCount + " reference names (" +
        collisionCount + " skipped due to name collisions).");
}

// -----------------------------------------------------------------------------
// Per-file processing
// -----------------------------------------------------------------------------

function processLineageFile(path, segment) {
    log("=== Processing " + path + " (segment " + segment + ") ===");

    var rows = readTsv(path);
    log("Loaded " + rows.length + " rows from " + path);

    var lineageToRows = {};
    var orderedLineages = [];

    _.each(rows, function(row) {
        var lineage = norm(row.lineage);
        var accession = norm(row.accession);
        var isolate = norm(row.isolate);

        if(lineage === null) {
            log("Skipping row with missing lineage (isolate=" + isolate + ")");
            return;
        }
        if(accession === null) {
            log("Skipping row with missing accession (isolate=" + isolate +
                ", lineage=" + lineage + ")");
            return;
        }

        if(!lineageToRows[lineage]) {
            lineageToRows[lineage] = [];
            orderedLineages.push(lineage);
        }
        lineageToRows[lineage].push({
            lineage: lineage,
            accession: accession,
            isolate: isolate
        });
    });

    log("Found " + orderedLineages.length + " distinct lineages in " +
        path + ": " + orderedLineages.join(", "));

    // -------------------------------------------------------------------------
    // Step 1: Declare one reference sequence per lineage
    // -------------------------------------------------------------------------

    var refsCreated = 0;
    var refsExisting = 0;
    var refsSkipped = 0;

    var representatives = [];

    _.each(orderedLineages, function(lineage) {
        var candidates = lineageToRows[lineage];
        var chosen = candidates[0];

        var strain = sanitizeForRefName(chosen.isolate);
        // New naming convention: segment first, then lineage, then strain.
        var refName = "REF_" + segment + "_" + lineage + "_" + strain;

        var seq = findSequenceByAccession(chosen.accession);
        if(seq === null) {
            log("WARNING: no sequence found with sequenceID '" +
                chosen.accession + "' for lineage " + lineage +
                " (isolate=" + chosen.isolate + "); skipping reference.");
            refsSkipped++;
            return;
        }

        representatives.push({
            lineage: lineage,
            refName: refName,
            sourceName: seq.sourceName,
            sequenceID: seq.sequenceID
        });

        if(referenceExists(refName)) {
            log("Reference already exists: " + refName + " -> " +
                seq.sourceName + "/" + seq.sequenceID);
            refsExisting++;
            return;
        }

        runCmd([
            "create", "reference",
            refName,
            seq.sourceName,
            seq.sequenceID
        ]);

        log("Created " + refName + " from " + seq.sourceName + "/" +
            seq.sequenceID + " for lineage " + lineage);
        refsCreated++;
    });

    // -------------------------------------------------------------------------
    // Step 2: Set sequence.rec_lineage for every row
    // -------------------------------------------------------------------------

    var setCount = 0;
    var missingCount = 0;

    _.each(rows, function(row) {
        var lineage = norm(row.lineage);
        var accession = norm(row.accession);

        if(lineage === null || accession === null) {
            return;
        }

        var seq = findSequenceByAccession(accession);
        if(seq === null) {
            log("WARNING: no sequence found with sequenceID '" + accession +
                "' (lineage=" + lineage + "); cannot set rec_lineage.");
            missingCount++;
            return;
        }

        glue.inMode("/sequence/" + seq.sourceName + "/" + seq.sequenceID,
            function() {
                runCmd(["set", "field", "rec_lineage", lineage]);
            });

        setCount++;
    });

    // -------------------------------------------------------------------------
    // Step 3: Flag representative isolates as is_reference = TRUE
    // -------------------------------------------------------------------------

    var flaggedCount = 0;
    var isolateMissingCount = 0;

    _.each(representatives, function(rep) {
        if(!isolateRowExists(rep.sequenceID)) {
            log("WARNING: no isolate custom-table row for id '" +
                rep.sequenceID + "' (lineage " + rep.lineage +
                "); cannot set is_reference.");
            isolateMissingCount++;
            return;
        }

        glue.inMode("custom-table-row/isolate/" + rep.sequenceID, function() {
            runCmd(["set", "field", "is_reference", "TRUE"]);
        });

        log("Set isolate.is_reference=TRUE for " + rep.sequenceID +
            " (lineage " + rep.lineage + ")");
        flaggedCount++;
    });

    log("--- Summary for " + path + " ---");
    log("  References: created=" + refsCreated +
        ", already existed=" + refsExisting +
        ", skipped (missing sequence)=" + refsSkipped);
    log("  rec_lineage set on " + setCount +
        " sequences (" + missingCount +
        " rows skipped due to missing sequences).");
    log("  is_reference set on " + flaggedCount +
        " isolates (" + isolateMissingCount +
        " representatives had no isolate row).");

    return {
        path: path,
        segment: segment,
        rowCount: rows.length,
        lineageCount: orderedLineages.length,
        refsCreated: refsCreated,
        refsExisting: refsExisting,
        refsSkipped: refsSkipped,
        setCount: setCount,
        missingCount: missingCount,
        flaggedCount: flaggedCount,
        isolateMissingCount: isolateMissingCount
    };
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

migrateLegacyReferenceNames();

var summaries = [];

_.each(TSV_INPUTS, function(input) {
    summaries.push(processLineageFile(input.path, input.segment));
});

log("=== Aggregate summary across " + summaries.length + " files ===");
_.each(summaries, function(s) {
    log("  " + s.path + " (segment " + s.segment + "): rows=" + s.rowCount +
        ", lineages=" + s.lineageCount +
        ", refs created=" + s.refsCreated +
        ", refs existing=" + s.refsExisting +
        ", rec_lineage set=" + s.setCount +
        ", is_reference flagged=" + s.flaggedCount +
        ", missing=" + (s.missingCount + s.isolateMissingCount));
});

