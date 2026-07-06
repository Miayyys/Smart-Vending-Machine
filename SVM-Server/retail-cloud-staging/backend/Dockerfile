# 多阶段构建：maven 打包 -> 轻量 JRE 跑
FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn -B -q dependency:go-offline
COPY src ./src
RUN mvn -B -q clean package -DskipTests

FROM eclipse-temurin:17-jre-jammy
WORKDIR /app
COPY --from=build /app/target/*.jar app.jar
EXPOSE 8080
ENV JAVA_OPTS="-Xms128m -Xmx256m -XX:MaxRAMPercentage=60 -Dfile.encoding=UTF-8"
ENTRYPOINT ["sh","-c","java $JAVA_OPTS -jar app.jar"]