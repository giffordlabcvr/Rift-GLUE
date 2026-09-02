/*
 * riftLinkSequencesToIsolates.js
 *
 * For every sequence in the configured rift sources:
 *
 *   1. Ensure that an isolate custom-table row exists.
 *   2. Use the sequence ID as the isolate row ID.
 *   3. Link the sequence to that isolate row.
 *
 * Sources processed:
 *
 *   - ncbi-core-rift
 *   - ncbi-refseqs-rift
 *
 * Assumes:
 *
 *   - the isolate custom table exists
 *   - a sequence -> isolate custom-table link exists
 *   - the script is run from project mode
 */

var SOURCE_NAMES = [
    "ncbi-core-rift",
    "ncbi-refseqs-rift"
];

var DRY_RUN = false;


function log(message) {
    glue.logInfo(message);
}


function escapeQuotes(value) {
    return ("" + value).replace(/'/g, "\\'");
}


/*
 * Load the IDs of existing isolate rows.
 *
 * Keeping these in a lookup avoids attempting to create duplicate rows.
 */

var isolateResult = glue.command([
    "list", "custom-table-row", "isolate",
    "id"
]);

var existingIsolateIds = {};

_.each(
    glue.getTableColumn(isolateResult, "id"),
    function(isolateId) {
        existingIsolateIds[isolateId] = true;
    }
);

log(
    "Loaded " +
    Object.keys(existingIsolateIds).length +
    " existing isolate row IDs"
);


/*
 * Process each configured source.
 */

var totalSequenceCount = 0;
var createdIsolateCount = 0;
var linkedSequenceCount = 0;

_.each(SOURCE_NAMES, function(sourceName) {

    log("Processing source: " + sourceName);

	var sequenceResult = glue.command([
		"list", "sequence",
		"-w",
		"source.name = '" + escapeQuotes(sourceName) + "'",
		"sequenceID"
	]);

    var sequenceIds = glue.getTableColumn(
        sequenceResult,
        "sequenceID"
    );

    var sourceCreatedCount = 0;
    var sourceLinkedCount = 0;

    _.each(sequenceIds, function(sequenceId) {

        totalSequenceCount++;

        /*
         * Create the isolate row if it does not already exist.
         *
         * Updating the lookup immediately also handles an accession that
         * occurs in both configured sources.
         */

        if (existingIsolateIds[sequenceId] !== true) {

            if (!DRY_RUN) {
                glue.command([
                    "create", "custom-table-row",
                    "isolate", sequenceId
                ]);
            }

            existingIsolateIds[sequenceId] = true;

            createdIsolateCount++;
            sourceCreatedCount++;

            log(
                (DRY_RUN ? "Would create" : "Created") +
                " isolate row: " + sequenceId
            );
        }

        /*
         * Link the sequence to its isolate row.
         */

        if (!DRY_RUN) {
            glue.inMode(
                "sequence/" + sourceName + "/" + sequenceId,
                function() {
                    glue.command([
                        "set", "link-target",
                        "isolate",
                        "custom-table-row/isolate/" + sequenceId
                    ]);
                }
            );
        }

        linkedSequenceCount++;
        sourceLinkedCount++;
    });

    log(
        "Completed source " + sourceName +
        ": " + sequenceIds.length + " sequences, " +
        sourceCreatedCount + " isolate rows created, " +
        sourceLinkedCount + " sequences linked"
    );
});


log("----- ISOLATE LINKING SUMMARY -----");
log("Sequences processed: " + totalSequenceCount);
log("Isolate rows created: " + createdIsolateCount);
log("Sequences linked: " + linkedSequenceCount);
log("Dry run: " + DRY_RUN);
