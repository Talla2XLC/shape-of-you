FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY --chown=nginx:nginx nginx.conf.template /etc/nginx/nginx.conf.template
COPY --chown=nginx:nginx bootstrap.conf /etc/nginx/bootstrap.conf
COPY --chown=nginx:nginx start-edge.sh /usr/local/bin/start-shape-of-you-edge

USER nginx
EXPOSE 8080 8081 8443

CMD ["/usr/local/bin/start-shape-of-you-edge"]
