FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY --chown=nginx:nginx nginx.conf /etc/nginx/nginx.conf
COPY --chown=nginx:nginx bootstrap.conf /etc/nginx/bootstrap.conf

USER nginx
EXPOSE 8080 8081 8443

CMD ["nginx", "-g", "daemon off;"]
