/*
 * riftSetCompleteGenomes.js
 *
 * Identify isolates represented by all three rift genome segments:
 *
 *   S
 *   M
 *   L
 *
 * For every such isolate, set sequence.complete_genome to true on all
 * associated sequence records.
 *
 * Sequences without an isolate ID or recognised segment are ignored.
 *
 * Run from project mode:
 *
 *   run script glue/build/riftSetCompleteGenomes.js
 */

var REQUIRED_SEGMENTS = [
    "S",
    "M",
    "L"
];


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


/*
 * Load the relevant sequence properties.
 *
 * source.name is included because a GLUE sequence is uniquely identified
 * by the combination of source name and sequence ID.
 */

var sequences = glue.tableToObjects(
    glue.command([
        "list", "sequence",
        "source.name",
        "sequenceID",
        "rec_segment",
        "isolate.isolate_id"
    ])
);

log("Loaded " + sequences.length + " sequence records");


/*
 * Group sequences by resolved isolate ID.
 */

var isolatesById = {};

_.each(sequences, function(sequence) {

    var isolateId = normalise(sequence["isolate.isolate_id"]);
    var segment = normalise(sequence["rec_segment"]);

    if (isolateId === null || segment === null) {
        return;
    }

    segment = segment.toUpperCase();

    if (REQUIRED_SEGMENTS.indexOf(segment) === -1) {
        return;
    }

    if (isolatesById[isolateId] === undefined) {
        isolatesById[isolateId] = {
            segments: {},
            sequences: []
        };
    }

    isolatesById[isolateId].segments[segment] = true;

    isolatesById[isolateId].sequences.push({
        sourceName: sequence["source.name"],
        sequenceId: sequence["sequenceID"],
        segment: segment
    });
});


/*
 * Identify complete isolates and update their associated sequences.
 */

var completeIsolateCount = 0;
var updatedSequenceCount = 0;

_.each(Object.keys(isolatesById), function(isolateId) {

    var isolateGroup = isolatesById[isolateId];

    var isComplete =
        isolateGroup.segments["S"] === true &&
        isolateGroup.segments["M"] === true &&
        isolateGroup.segments["L"] === true;

    if (!isComplete) {
        return;
    }

    completeIsolateCount++;

    log(
        "Complete genome isolate: " +
        isolateId +
        " (" + isolateGroup.sequences.length + " sequences)"
    );

    _.each(isolateGroup.sequences, function(sequence) {

        glue.inMode(
            "sequence/" +
            sequence.sourceName +
            "/" +
            sequence.sequenceId,
            function() {
                glue.command([
                    "set", "field",
                    "complete_genome",
                    "true"
                ]);
            }
        );

        updatedSequenceCount++;

        log(
            "Set complete_genome = true: " +
            sequence.sourceName + "/" +
            sequence.sequenceId +
            " [" + sequence.segment + "]"
        );
    });
});


log("----- COMPLETE GENOME SUMMARY -----");
log("Isolates examined: " + Object.keys(isolatesById).length);
log("Complete isolates found: " + completeIsolateCount);
log("Sequence records updated: " + updatedSequenceCount);
