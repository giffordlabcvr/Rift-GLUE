// genotypeUnassignedSequences.js
//
// For each segment (S, M, L), find all sequences that:
//   - belong to that segment
//   - have NULL rec_major_clade and rec_lineage
// and run the corresponding maxLikelihoodGenotyper on each.
//
// The genotyper results are written back to the sequence's
// rec_major_clade and rec_lineage fields.
//
// Modelled on denvDoBatchGenotyping.js from the DENV GLUE project.

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

// -----------------------------------------------------------------------------
// Finding candidate sequences
// -----------------------------------------------------------------------------

function findUnassignedSequences(segment) {
    var whereClause =
        "rec_segment = '" + escapeQuotes(segment) + "'" +
        " and rec_major_clade = null" +
        " and rec_lineage = null";

    var rows = queryObjects([
        "list", "sequence",
        "sequenceID",
        "source.name",
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
            segment: segment
        });
    }
    return results;
}

// -----------------------------------------------------------------------------
// Running the genotyper
// -----------------------------------------------------------------------------

// Run the genotyper on a single sequence. Returns
// { majorClade, lineage } or null if the tool couldn't assign.
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

    // With JSON output, result may be a pre-parsed JS object or a raw string.
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
    if(values === null || values === undefined || values.length < 3) {
        return null;
    }
    // Column order (as observed in your output):
    //   0 queryName, 1 major_cladeFinalClade, 2 lineageFinalClade
    return {
        queryName: values[0],
        majorClade: values[1],
        lineage: values[2]
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
    assigned: 0,
    noAssignment: 0,
    errors: 0
};

_.each(SEGMENTS, function(segmentDef) {
    log("=== Segment " + segmentDef.segment +
        " (" + segmentDef.modulePath + ") ===");

    var candidates = findUnassignedSequences(segmentDef.segment);
    log("Found " + candidates.length + " unassigned sequences in segment " +
        segmentDef.segment);

    _.each(candidates, function(cand) {
        totals.scanned++;
        var label = cand.sourceName + "/" + cand.sequenceID;

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

        if(result === null ||
           result.majorClade === null || result.majorClade === undefined ||
           result.lineage === null || result.lineage === undefined) {
            log("No clade assignment for " + label);
            totals.noAssignment++;
            return;
        }
        if(result.majorClade === "" || result.majorClade === "NA" ||
           result.majorClade === "null") {
            log("Empty major_clade result for " + label);
            totals.noAssignment++;
            return;
        }
        if(result.lineage === "" || result.lineage === "NA" ||
           result.lineage === "null") {
            log("Empty lineage result for " + label);
            totals.noAssignment++;
            return;
        }

        setSequenceField(cand.sourceName, cand.sequenceID,
            segmentDef.majorCladeField, result.majorClade);
        setSequenceField(cand.sourceName, cand.sequenceID,
            segmentDef.lineageField, result.lineage);

        log("Assigned " + label +
            " -> major_clade=" + result.majorClade +
            ", lineage=" + result.lineage);
        totals.assigned++;
    });
});

log("=== Summary ===");
log("Scanned: " + totals.scanned);
log("Assigned: " + totals.assigned);
log("No assignment: " + totals.noAssignment);
log("Errors: " + totals.errors);
