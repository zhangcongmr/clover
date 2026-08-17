use mydb;
create table if NOT exists table1 (
   id int(11) unsigned NOT NULL AUTO_INCREMENT,
	coll TEXT(1000)  DEFAULT NULL,
	primary key(id)
)engine=InnoDB AUTO_INCREMENT=1000000 DEFAULT CHARSET=UTF8;

delimiter $$
DROP FUNCTION if EXISTS rand_string;
create function rand_string(n INT) returns TEXT(1000)  charset utf8
begin
   declare chars_str char(100) default 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRTSUVWXYZ0123456789';
	declare return_str TEXT(1000)  default '';
	declare i int default 0;
	WHILE i < n do
	   set return_str=concat(return_str, substring(chars_str, FLOOR(1+RAND()*62),1));
		set i=i+1;
	END while;
	return return_str;
END$$

delimiter ;

delimiter $$
drop procedure if exists insert_values;
create procedure insert_values(in m int)
begin
  set @i=1;
  while @i<m do
     insert into table1(coll) select rand_string(10);
     set @i=@i+1;
  end while;
 end$$
 delimiter ;
 
 call insert_values(1000000);