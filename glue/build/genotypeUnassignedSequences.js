// genotypeUnassignedSequences.js
//
// For each segment (S, M, L), find sequences that:
//   - belong to that segment
//   - have NULL or missing rec_major_clade OR rec_lineage
// and run the corresponding maxLikelihoodGenotyper on each.
//
// Results are written back to the sequence's rec_major_clade and
// rec_lineage fields. Existing (non-null) values are not overwritten.
//
// IMPORTANT: expects the console to be in JSON result format:
//
//     GLUE> console set cmd-result-format json
//     GLUE> run script glue/build/genotypeUnassignedSequences.js

var SEGMENTS = [
    {
        segment: "S",
        modulePath: "/module/riftMaxLikelihoodGenotyperSegS",
        majorCladeField: "rec_major_clade",
        lineageField: "rec_lineage"
    },
    {
        segment: "M",
        modulePath: "/module/riftMaxLikelihoodGenotyperSegM",
        majorCladeField: "rec_major_clade",
        lineageField: "rec_lineage"
    },
    {
        segment: "L",
        modulePath: "/module/riftMaxLikelihoodGenotyperSegL",
        majorCladeField: "rec_major_clade",
        lineageField: "rec_lineage"
    }
];

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function log(msg) {
    glue.log("INFO", msg);
}

function escapeQuotes(value) {
    return ("" + value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function queryObjects(cmdWords) {
    return glue.tableToObjects(glue.command(cmdWords));
}

// Treat various "empty" encodings as no-assignment.
function isMissing(value) {
    if(value === null || value === undefined) {
        return true;
    }
    var s = ("" + value).trim();
    if(s === "") {
        return true;
    }
    var low = s.toLowerCase();
    if(low === "null" || low === "na" || low === "n/a" || low === "-") {
        return true;
    }
    return false;
}

// -----------------------------------------------------------------------------
// Finding candidate sequences
// -----------------------------------------------------------------------------

function findUnassignedSequences(segment) {
    // Pick up rows where EITHER field is missing. This lets a rerun fill
    // in partially-assigned records.
    var whereClause =
        "rec_segment = '" + escapeQuotes(segment) + "'" +
        " and (rec_major_clade = null or rec_lineage = null)";

    var rows = queryObjects([
        "list", "sequence",
        "sequenceID",
        "source.name",
        "rec_major_clade",
        "rec_lineage",
        "-w", whereClause
    ]);

    var results = [];
    for(var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var sourceName = r["source.name"];
        var sequenceID = r.sequenceID;
        if(sourceName === null || sourceName === undefined) {
            continue;
        }
        if(sequenceID === null || sequenceID === undefined) {
            continue;
        }
        results.push({
            sourceName: "" + sourceName,
            sequenceID: "" + sequenceID,
            segment: segment,
            existingMajorClade: r.rec_major_clade,
            existingLineage: r.rec_lineage
        });
    }
    return results;
}

// -----------------------------------------------------------------------------
// Running the genotyper
// -----------------------------------------------------------------------------

// Resolve a column name to its index in the result column array.
function columnIndex(columns, name) {
    if(columns === null || columns === undefined) {
        return -1;
    }
    for(var i = 0; i < columns.length; i++) {
        if(columns[i] === name) {
            return i;
        }
    }
    return -1;
}

// Run the genotyper on a single sequence. Returns
// { majorClade, lineage } (either may be null) or null on parse failure.
function runGenotyper(modulePath, sourceName, sequenceID) {
    var whereClause =
        "sequenceID = '" + escapeQuotes(sequenceID) + "'" +
        " and source.name = '" + escapeQuotes(sourceName) + "'";

    var genotypeResults;
    glue.inMode(modulePath, function() {
        genotypeResults = glue.command([
            "genotype", "sequence", "-w", whereClause
        ]);
    });

    if(genotypeResults === null || genotypeResults === undefined) {
        return null;
    }
    if(typeof genotypeResults === "string") {
        try {
            genotypeResults = JSON.parse(genotypeResults);
        } catch(e) {
            log("Could not parse JSON result: " + e);
            return null;
        }
    }

    var gcr = genotypeResults.genotypeCommandResult;
    if(gcr === null || gcr === undefined) {
        return null;
    }
    var rows = gcr.row;
    if(rows === null || rows === undefined || rows.length === 0) {
        return null;
    }
    var values = rows[0].value;
    if(values === null || values === undefined) {
        return null;
    }

    var columns = gcr.column;
    var majorIdx = columnIndex(columns, "major_cladeFinalClade");
    var lineageIdx = columnIndex(columns, "lineageFinalClade");
    if(majorIdx < 0 || lineageIdx < 0) {
        log("Expected genotype result columns not found " +
            "(major_cladeFinalClade=" + majorIdx +
            ", lineageFinalClade=" + lineageIdx + ")");
        return null;
    }

    return {
        majorClade: values[majorIdx],
        lineage: values[lineageIdx]
    };
}

// -----------------------------------------------------------------------------
// Writing results back
// -----------------------------------------------------------------------------

function setSequenceField(sourceName, sequenceID, fieldName, value) {
    glue.inMode("/sequence/" + sourceName + "/" + sequenceID, function() {
        glue.command(["set", "field", fieldName, value]);
    });
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

var totals = {
    scanned: 0,
    fullyAssigned: 0,
    assignedMajorClade: 0,
    assignedLineage: 0,
    noAssignment: 0,
    errors: 0
};

_.each(SEGMENTS, function(segmentDef) {
    log("=== Segment " + segmentDef.segment +
        " (" + segmentDef.modulePath + ") ===");

    var candidates = findUnassignedSequences(segmentDef.segment);
    log("Found " + candidates.length + " unassigned/partial sequences in " +
        "segment " + segmentDef.segment);

    _.each(candidates, function(cand) {
        totals.scanned++;
        var label = cand.sourceName + "/" + cand.sequenceID;

        // ---- Stage 1: genotype -----------------------------------------

        var result;
        try {
            result = runGenotyper(
                segmentDef.modulePath,
                cand.sourceName,
                cand.sequenceID
            );
        } catch(e) {
            log("ERROR genotyping " + label + ": " + e);
            totals.errors++;
            return;
        }

        var hasMajorResult = result !== null && !isMissing(result.majorClade);
        var hasLineageResult = result !== null && !isMissing(result.lineage);

        if(!hasMajorResult && !hasLineageResult) {
            log("No clade assignment for " + label);
            totals.noAssignment++;
            return;
        }

        // Only write fields that are currently missing on the sequence.
        // Existing values are preserved.
        var needMajor = hasMajorResult && isMissing(cand.existingMajorClade);
        var needLineage = hasLineageResult && isMissing(cand.existingLineage);

        if(!needMajor && !needLineage) {
            log("Assignments available but existing fields populated for " +
                label + " (major=" + cand.existingMajorClade +
                ", lineage=" + cand.existingLineage + ")");
            return;
        }

        // ---- Stage 2: write back --------------------------------------

        try {
            if(needMajor) {
                setSequenceField(
                    cand.sourceName, cand.sequenceID,
                    segmentDef.majorCladeField, result.majorClade
                );
                totals.assignedMajorClade++;
            }
            if(needLineage) {
                setSequenceField(
                    cand.sourceName, cand.sequenceID,
                    segmentDef.lineageField, result.lineage
                );
                totals.assignedLineage++;
            }
        } catch(e) {
            log("ERROR updating " + label + ": " + e);
            totals.errors++;
            return;
        }

        if(needMajor && needLineage) {
            totals.fullyAssigned++;
        }

        log("Updated " + label +
            (needMajor ? " major_clade=" + result.majorClade : "") +
            (needLineage ? " lineage=" + result.lineage : ""));
    });
});

log("=== Summary ===");
log("Scanned: " + totals.scanned);
log("Fully assigned (both fields written): " + totals.fullyAssigned);
log("Major clade written: " + totals.assignedMajorClade);
log("Lineage written: " + totals.assignedLineage);
log("No assignment: " + totals.noAssignment);
log("Errors: " + totals.errors);
