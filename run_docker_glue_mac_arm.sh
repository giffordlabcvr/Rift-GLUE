docker run --rm -it \
  --platform linux/amd64 \
  --name gluetools \
  --network gluetools-network \
  --mount type=bind,source="$PWD",target=/workspace/Rift-GLUE \
  --workdir /workspace/Rift-GLUE \
  cvrbioinformatics/gluetools:latest