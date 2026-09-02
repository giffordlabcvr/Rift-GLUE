/*
 * riftDeletePatentRelatedSequences.js
 *
 * Delete sequences identified as patent-related from ncbi-core-rift.
 *
 * Input file columns:
 *
 *   sequenceID
 *   patent_related
 *
 * Assumes:
 *
 *   - tabularUtilityTab module exists
 *   - patent-related sequence data are stored in tabular/patent_related.tsv
 *   - the script is run from project mode
 */

var INPUT_FILE = "tabular/patent_related.tsv";
var SOURCE_NAME = "ncbi-core-rift";
var DRY_RUN = false;


function log(message) {
    glue.logInfo(message);
}


function normalise(value) {
    if (value === null || value === undefined) {
        return null;
    }

    var normalised = ("" + value).trim();

    if (normalised === "") {
        return null;
    }

    return normalised;
}


function isTrue(value) {
    var normalised = normalise(value);

    if (normalised === null) {
        return false;
    }

    return normalised.toLowerCase() === "true";
}


function escapeQuotes(value) {
    return ("" + value).replace(/'/g, "\\'");
}


/*
 * Load the patent classification table.
 */

var patentRows;

glue.inMode("module/tabularUtilityTab", function() {
    patentRows = glue.tableToObjects(
        glue.command([
            "load-tabular",
            INPUT_FILE
        ])
    );
});

log("Loaded " + patentRows.length + " rows from " + INPUT_FILE);


/*
 * Build a lookup containing sequence IDs marked patent-related.
 */

var patentRelatedSequenceIds = {};

_.each(patentRows, function(row) {

    var sequenceId = normalise(row["sequenceID"]);
    var patentRelated = isTrue(row["patent_related"]);

    if (sequenceId === null) {
        log(
            "Skipping patent table row with no sequenceID: " +
            JSON.stringify(row)
        );
        return;
    }

    if (patentRelated) {
        patentRelatedSequenceIds[sequenceId] = true;
    }
});

log(
    "Found " +
    Object.keys(patentRelatedSequenceIds).length +
    " patent-related sequence IDs"
);


/*
 * List the sequences currently present in the core source.
 */

var sequenceResult = glue.command([
    "list", "sequence",
    "-w",
    "source.name = '" + escapeQuotes(SOURCE_NAME) + "'"
]);

var sequenceIds = glue.getTableColumn(
    sequenceResult,
    "sequenceID"
);


/*
 * Delete sequences that occur in the patent-related lookup.
 */

var deletedCount = 0;
var notPresentCount = 0;

_.each(Object.keys(patentRelatedSequenceIds), function(sequenceId) {

    if (sequenceIds.indexOf(sequenceId) === -1) {
        notPresentCount++;
        return;
    }

    if (!DRY_RUN) {
        glue.command([
            "delete", "sequence",
            "-w",
            "source.name = '" + escapeQuotes(SOURCE_NAME) +
            "' and sequenceID = '" + escapeQuotes(sequenceId) + "'"
        ]);
    }

    deletedCount++;

    log(
        (DRY_RUN ? "Would delete" : "Deleted") +
        " patent-related sequence: " +
        SOURCE_NAME + "/" + sequenceId
    );
});


log("----- PATENT FILTER SUMMARY -----");
log("Source: " + SOURCE_NAME);
log("Patent-related sequences deleted: " + deletedCount);
log("Patent-related IDs not present in source: " + notPresentCount);
log("Dry run: " + DRY_RUN);
