FROM golang:1.25.3-alpine AS build
RUN apk add --no-cache git
WORKDIR /source
RUN git init && git remote add origin https://github.com/stripe/smokescreen.git \
    && git fetch --depth=1 origin 609eb8931420453daf5893509be0b25b21bd9edb \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = 609eb8931420453daf5893509be0b25b21bd9edb
RUN CGO_ENABLED=0 go build -trimpath -o /smokescreen .
FROM alpine:3.22.1
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 proxy
COPY --from=build /smokescreen /usr/local/bin/smokescreen
COPY --from=build /source/LICENSE* /licenses/
COPY proxy.yaml acl.yaml /config/
USER proxy
ENTRYPOINT ["smokescreen", "--config-file", "/config/proxy.yaml"]
